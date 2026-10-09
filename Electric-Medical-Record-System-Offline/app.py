import streamlit as st
import pandas as pd
from datetime import datetime, date, time
import base64
import json
import os
import time as time_module
from io import BytesIO
from PIL import Image
from filelock import FileLock
from streamlit_autorefresh import st_autorefresh

st.set_page_config(
    page_title="Humanity First Electronic Medical Records System",
    page_icon="",
    layout="wide",
    initial_sidebar_state="expanded"
)

st.markdown("""
<style>
    @import url('https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Source+Sans+Pro:wght@400;600&display=swap');
    html, body, [class*="css"] {
        font-family: 'Source Sans Pro', 'Georgia', serif;
        letter-spacing: 0.02em;
    }
    h1, h2, h3, h4, h5, h6 {
        font-family: 'Merriweather', 'Georgia', serif;
        letter-spacing: 0.03em;
    }
    .stApp { background-color: #ffffff; }
    .main-header {
        font-family: 'Merriweather', 'Georgia', serif;
        font-size: 2.5rem; font-weight: 700; color: #1a3a5c;
        text-align: center; margin-bottom: 1.5rem; letter-spacing: 0.05em;
        padding: 1rem 0; border-bottom: 3px solid #2563eb;
    }
    .section-header {
        font-family: 'Merriweather', 'Georgia', serif;
        font-size: 1.4rem; color: #1e40af;
        border-bottom: 2px solid #3b82f6; padding-bottom: 0.5rem;
        margin-top: 1.5rem; letter-spacing: 0.03em; text-align: center;
    }
    .risk-high { background-color: #fee2e2; padding: 0.75rem; border-radius: 6px; border-left: 4px solid #dc2626; text-align: center; }
    .risk-medium { background-color: #fef3c7; padding: 0.75rem; border-radius: 6px; border-left: 4px solid #d97706; text-align: center; }
    .risk-low { background-color: #d1fae5; padding: 0.75rem; border-radius: 6px; border-left: 4px solid #059669; text-align: center; }
    .patient-card { background-color: #f8fafc; padding: 1.25rem; border-radius: 8px; margin-bottom: 1rem; border: 1px solid #e2e8f0; text-align: center; }
    .metric-card { background-color: #eff6ff; padding: 1.25rem; border-radius: 8px; text-align: center; border: 1px solid #bfdbfe; }
    .visit-card { background-color: #f0f9ff; padding: 1.25rem; border-radius: 8px; border-left: 4px solid #2563eb; margin-bottom: 0.75rem; text-align: center; }
    .trip-card { background-color: #f8fafc; padding: 1.5rem; border-radius: 10px; margin-bottom: 1rem; border: 1px solid #e2e8f0; cursor: pointer; }
    .medication-active { background-color: #ecfdf5; border-left: 4px solid #10b981; text-align: center; }
    .medication-inactive { background-color: #fef2f2; border-left: 4px solid #ef4444; text-align: center; }
    section[data-testid="stSidebar"] { background-color: #1e3a5f; }
    section[data-testid="stSidebar"] * { color: #ffffff !important; }
    section[data-testid="stSidebar"] .stMarkdown,
    section[data-testid="stSidebar"] .stMarkdown p,
    section[data-testid="stSidebar"] .stMarkdown h1,
    section[data-testid="stSidebar"] .stMarkdown h2,
    section[data-testid="stSidebar"] .stMarkdown h3,
    section[data-testid="stSidebar"] label,
    section[data-testid="stSidebar"] span,
    section[data-testid="stSidebar"] p,
    section[data-testid="stSidebar"] div { color: #ffffff !important; }
    .stButton > button { background-color: #2563eb; color: white; border: none; border-radius: 6px; font-family: 'Source Sans Pro', sans-serif; letter-spacing: 0.02em; }
    .stButton > button:hover { background-color: #1d4ed8; }
    .delete-btn button { background-color: transparent !important; color: #9ca3af !important; border: none !important; padding: 0 4px !important; font-size: 0.75rem !important; box-shadow: none !important; }
    .delete-btn button:hover { color: #dc2626 !important; }
    div[data-testid="stMetric"] { background-color: #eff6ff; padding: 1rem; border-radius: 8px; border: 1px solid #bfdbfe; text-align: center; }
    div[data-testid="stMetric"] label { color: #1e40af; }
    div[data-testid="stMetric"] div[data-testid="stMetricValue"] { color: #1a3a5c; }
</style>
""", unsafe_allow_html=True)

# Constants 
STUDENT_PIN = "1111"
DOCTOR_PIN  = "2222"

DATA_DIR   = "emr_data"
TRIPS_FILE = os.path.join(DATA_DIR, "trips.json")
TRIPS_LOCK = os.path.join(DATA_DIR, "trips.lock")

# Directory helpers
def ensure_data_directory():
    os.makedirs(DATA_DIR, exist_ok=True)

def get_trip_dir(trip_id):
    d = os.path.join(DATA_DIR, f"trip_{trip_id}")
    os.makedirs(d, exist_ok=True)
    return d

def get_trip_patients_file(trip_id):
    return os.path.join(get_trip_dir(trip_id), "patients.json")

def get_trip_counter_file(trip_id):
    return os.path.join(get_trip_dir(trip_id), "counter.json")

def get_trip_lock(trip_id):
    ensure_data_directory()
    return FileLock(os.path.join(get_trip_dir(trip_id), "patients.lock"), timeout=10)

def get_trips_lock():
    ensure_data_directory()
    return FileLock(TRIPS_LOCK, timeout=10)

# Trip management
def load_trips():
    ensure_data_directory()
    try:
        with get_trips_lock():
            if os.path.exists(TRIPS_FILE):
                with open(TRIPS_FILE, 'r') as f:
                    return json.load(f)
    except Exception:
        pass
    return {}

def save_trips(trips):
    ensure_data_directory()
    try:
        with get_trips_lock():
            with open(TRIPS_FILE, 'w') as f:
                json.dump(trips, f, indent=2)
    except Exception as e:
        st.error(f"Error saving trips: {e}")

def get_doctor_type_for_patient(p):
    """Return the doctor_type for a patient by checking diagnosis dict then trip_visit entry."""
    diag = p.get('diagnosis', {})
    if isinstance(diag, dict) and diag.get('doctor_type'):
        return diag['doctor_type']
    for v in p.get('visits', []):
        if v.get('trip_visit') and v.get('doctor_type'):
            return v['doctor_type']
    return None

def patient_seen_by_doctor(p):
    """Return True if a doctor has recorded a diagnosis or prescribed medications."""
    diag = p.get('diagnosis', {})
    has_diagnosis = isinstance(diag, dict) and bool(diag.get('diagnosis'))
    has_meds = any(m.get('status') == 'Active' for m in p.get('medications', []))
    return has_diagnosis or has_meds

def get_trip_stats(trip_id):
    patients = load_trip_patients(trip_id)
    total = len(patients)
    dentist = physician = pediatrician = 0
    for p in patients.values():
        if not patient_seen_by_doctor(p):
            continue
        dt = get_doctor_type_for_patient(p)
        if dt == 'Dentist':        dentist += 1
        elif dt == 'Physician':    physician += 1
        elif dt == 'Pediatrician': pediatrician += 1
    return {'total': total, 'dentist': dentist, 'physician': physician, 'pediatrician': pediatrician}

# Per-trip patient data
def load_trip_patients(trip_id):
    pf = get_trip_patients_file(trip_id)
    try:
        with get_trip_lock(trip_id):
            if os.path.exists(pf):
                with open(pf, 'r') as f:
                    return json.load(f)
    except Exception:
        pass
    return {}

def save_patients_to_file():
    tid = st.session_state.get('current_trip_id')
    if not tid:
        return
    try:
        with get_trip_lock(tid):
            with open(get_trip_patients_file(tid), 'w') as f:
                json.dump(st.session_state.patients, f, indent=2)
            with open(get_trip_counter_file(tid), 'w') as f:
                json.dump({'counter': st.session_state.patient_counter}, f)
    except Exception as e:
        st.error(f"Error saving data: {e}")

def save_patient_record(patient_id):
    tid = st.session_state.get('current_trip_id')
    if not tid:
        return
    pf = get_trip_patients_file(tid)
    try:
        with get_trip_lock(tid):
            patients = {}
            if os.path.exists(pf):
                with open(pf, 'r') as f:
                    patients = json.load(f)
            patients[patient_id] = st.session_state.patients[patient_id]
            with open(pf, 'w') as f:
                json.dump(patients, f, indent=2)
            st.session_state.patients = patients
    except Exception as e:
        st.error(f"Error saving patient record: {e}")

def generate_patient_id():
    tid = st.session_state.get('current_trip_id', '01_2000')
    cf  = get_trip_counter_file(tid)
    try:
        with get_trip_lock(tid):
            counter = 0
            if os.path.exists(cf):
                with open(cf, 'r') as f:
                    counter = json.load(f).get('counter', 0)
            counter += 1
            with open(cf, 'w') as f:
                json.dump({'counter': counter}, f)
            st.session_state.patient_counter = counter
            return f"{counter:03d}_{tid}"
    except Exception as e:
        st.error(f"Error generating patient ID: {e}")
        st.session_state.patient_counter += 1
        return f"{st.session_state.patient_counter:03d}_{tid}"

def delete_patient_and_renumber(patient_id_to_delete):
    tid = st.session_state.get('current_trip_id')
    if not tid:
        return
    pf = get_trip_patients_file(tid)
    cf = get_trip_counter_file(tid)
    try:
        with get_trip_lock(tid):
            patients = {}
            if os.path.exists(pf):
                with open(pf, 'r') as f:
                    patients = json.load(f)
            patients.pop(patient_id_to_delete, None)

            def seq(pid):
                try: return int(pid.split('_')[0])
                except: return 999999

            sorted_pts = sorted(patients.items(), key=lambda x: seq(x[0]))
            parts = tid.split('_')
            mm, yyyy = parts[0], parts[1]
            new_patients = {}
            for i, (_, pdata) in enumerate(sorted_pts):
                new_pid = f"{(i+1):03d}_{mm}_{yyyy}"
                if isinstance(pdata.get('trip_visit'), dict):
                    pdata['trip_visit']['patient_id'] = new_pid
                new_patients[new_pid] = pdata

            with open(pf, 'w') as f:
                json.dump(new_patients, f, indent=2)
            with open(cf, 'w') as f:
                json.dump({'counter': len(new_patients)}, f)
            st.session_state.patients = new_patients
            st.session_state.patient_counter = len(new_patients)
    except Exception as e:
        st.error(f"Error deleting patient: {e}")

# Auto-visit sync helpers
def get_trip_visit_index(patient_id):
    visits = st.session_state.patients.get(patient_id, {}).get('visits', [])
    for i, v in enumerate(visits):
        if v.get('trip_visit'):
            return i
    return None

def sync_vitals_to_trip_visit(patient_id, vitals_entry):
    idx = get_trip_visit_index(patient_id)
    if idx is not None:
        st.session_state.patients[patient_id]['visits'][idx]['vitals'] = vitals_entry

def sync_diagnosis_to_trip_visit(patient_id, chief_complaint, diagnosis_text, treatment):
    idx = get_trip_visit_index(patient_id)
    if idx is not None:
        tv = st.session_state.patients[patient_id]['visits'][idx]
        tv['diagnosis_info'] = {
            'chief_complaint': chief_complaint,
            'diagnosis': diagnosis_text,
            'treatment': treatment
        }
        tv['doctor_type'] = st.session_state.get('doctor_type')
        # Also persist to top-level patient diagnosis field
        st.session_state.patients[patient_id]['diagnosis'] = {
            'chief_complaint': chief_complaint,
            'diagnosis': diagnosis_text,
            'treatment': treatment,
            'doctor_type': st.session_state.get('doctor_type'),
            'recorded_at': str(datetime.now())
        }

def sync_medication_to_trip_visit(patient_id):
    idx = get_trip_visit_index(patient_id)
    if idx is not None:
        meds = st.session_state.patients[patient_id].get('medications', [])
        st.session_state.patients[patient_id]['visits'][idx]['medications'] = [
            m for m in meds if m.get('status') == 'Active'
        ]

def sync_doctor_type_to_trip_visit(patient_id):
    idx = get_trip_visit_index(patient_id)
    if idx is not None:
        dt = st.session_state.get('doctor_type')
        if dt:
            st.session_state.patients[patient_id]['visits'][idx]['doctor_type'] = dt

def auto_save_doctor_visit(patient_id):
    """Creates or updates a visit entry whenever medications are prescribed."""
    patient = st.session_state.patients[patient_id]
    diagnosis_info = patient.get('diagnosis', {})
    if not isinstance(diagnosis_info, dict):
        diagnosis_info = {}
    active_meds = [m for m in patient.get('medications', []) if m.get('status') == 'Active']
    doctor_type = st.session_state.get('doctor_type', '')
    today = str(date.today())

    chief_complaint = diagnosis_info.get('chief_complaint', '')
    diagnosis_text  = diagnosis_info.get('diagnosis', '')
    treatment       = diagnosis_info.get('treatment', '')
    med_summary     = '; '.join(
        f"{m.get('medication','')} {m.get('dosage','')} ({m.get('frequency','')})"
        for m in active_meds
    )
    notes = f"Prescribed by {doctor_type}." + (f" Medications: {med_summary}" if med_summary else '')

    visit_entry = {
        'date': today,
        'time': str(datetime.now().strftime('%H:%M:%S')),
        'visit_type': 'Trip Visit',
        'chief_complaint': chief_complaint,
        'symptoms': '',
        'diagnosis': diagnosis_text,
        'treatment': treatment,
        'medications_prescribed': med_summary,
        'doctor_type': doctor_type,
        'auto_saved': True,
        'follow_up_date': None,
        'notes': notes,
        'recorded_at': str(datetime.now())
    }

    visits = patient.get('visits', [])
    existing_idx = next(
        (i for i, v in enumerate(visits)
         if v.get('auto_saved') and v.get('date') == today and not v.get('trip_visit')),
        None
    )
    if existing_idx is not None:
        st.session_state.patients[patient_id]['visits'][existing_idx] = visit_entry
    else:
        st.session_state.patients[patient_id]['visits'].append(visit_entry)

# Session state
def initialize_session_state():
    defaults = {
        'logged_in': False,
        'role': None,
        'doctor_type': None,
        'current_trip_id': None,
        'current_trip_name': None,
        'patients': {},
        'patient_counter': 0,
        'current_patient_id': None,
        'page': 'Dashboard',
        'doctor_selected_patient_id': None,
        'initialized': True,
    }
    for k, v in defaults.items():
        if k not in st.session_state:
            st.session_state[k] = v

# Utilities
def image_to_base64(image):
    buf = BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

def base64_to_image(b64):
    return Image.open(BytesIO(base64.b64decode(b64)))

def calculate_age(birth_date):
    today = date.today()
    return today.year - birth_date.year - ((today.month, today.day) < (birth_date.month, birth_date.day))

def format_dob(dob_str):
    """Convert YYYY-MM-DD to MM/DD/YYYY for display."""
    try:
        d = datetime.strptime(dob_str, '%Y-%m-%d').date()
        return d.strftime('%m/%d/%Y')
    except Exception:
        return dob_str

def parse_dob(dob_str):
    """Parse stored YYYY-MM-DD to a date object."""
    try:
        return datetime.strptime(dob_str, '%Y-%m-%d').date()
    except Exception:
        return None

# Static lists
PREEXISTING_CONDITIONS = [
    "None",
    "Diabetes Type 1","Diabetes Type 2","Hypertension","Heart Disease","Asthma","COPD",
    "Chronic Kidney Disease","Liver Disease","Thyroid Disorder","Anemia","Arthritis",
    "Cancer","HIV/AIDS","Tuberculosis","Hepatitis","Malaria (Recurring)","Cholera (History)",
    "Typhoid (History)","Dysentery (History)","Parasitic Infection","Other"
]
WATER_CONTAMINATION_CONDITIONS = [
    "Cholera","Typhoid Fever","Dysentery","Hepatitis A","Giardiasis",
    "Cryptosporidiosis","Lead Poisoning","Arsenic Poisoning","Fluorosis","Parasitic Worms"
]
COMMON_MEDICATIONS = [
    "Metformin","Insulin (various types)","Lisinopril","Amlodipine","Atorvastatin",
    "Metoprolol","Omeprazole","Losartan","Gabapentin","Hydrochlorothiazide","Aspirin",
    "Ibuprofen","Acetaminophen","Amoxicillin","Ciprofloxacin","Azithromycin",
    "Prednisone","Albuterol","Fluticasone","Levothyroxine","Other"
]

# LOGIN

def render_login():
    st.markdown('''
<div style="text-align:center; padding: 1rem 0; border-bottom: 3px solid #2563eb; margin-bottom: 1.5rem;">
    <div style="font-family: Merriweather, Georgia, serif; font-size: 3.2rem; font-weight: 700; color: #2563eb; letter-spacing: 0.05em;">Humanity First</div>
    <div style="font-family: Merriweather, Georgia, serif; font-size: 2.5rem; font-weight: 700; color: #1a3a5c; letter-spacing: 0.05em;">Electronic Medical Records System</div>
</div>
''', unsafe_allow_html=True)
    col_l, col_c, col_r = st.columns([1, 2, 1])
    with col_c:
        st.markdown("### Sign In")
        role = st.radio("Select Role", ["Student", "Doctor"], horizontal=True, key="login_role")
        doctor_type = None
        if role == "Doctor":
            doctor_type = st.selectbox("Doctor Type", ["Dentist", "Physician", "Pediatrician"], key="login_doctor_type")
        pin = st.text_input("Enter PIN", type="password", key="login_pin")
        if st.button("Sign In", type="primary", use_container_width=True):
            if role == "Student" and pin == STUDENT_PIN:
                st.session_state.logged_in = True
                st.session_state.role = "student"
                st.session_state.doctor_type = None
                st.rerun()
            elif role == "Doctor" and pin == DOCTOR_PIN:
                st.session_state.logged_in = True
                st.session_state.role = "doctor"
                st.session_state.doctor_type = doctor_type
                st.rerun()
            else:
                st.error("Incorrect PIN. Please try again.")

#
# Trip home
def render_trip_home():
    st.markdown('<div class="main-header">Humanity First Electronic Medical Records System</div>', unsafe_allow_html=True)

    role_label = f"{st.session_state.role.capitalize()}"
    if st.session_state.doctor_type:
        role_label += f" — {st.session_state.doctor_type}"
    col_info, col_logout = st.columns([4, 1])
    with col_info:
        st.markdown(f"**Signed in as:** {role_label}")
    with col_logout:
        if st.button("Logout"):
            st.session_state.logged_in = False
            st.session_state.role = None
            st.session_state.doctor_type = None
            st.rerun()

    st.markdown("---")

    trips = load_trips()

    col_title, col_new = st.columns([5, 1])
    with col_title:
        st.markdown("## Clinic Trips")
    with col_new:
        if st.button("+ New Trip", type="primary"):
            st.session_state['show_create_trip'] = True

    if st.session_state.get('show_create_trip'):
        with st.form("create_trip_form"):
            st.markdown("### Create New Trip")
            trip_name = st.text_input("Trip Name", placeholder="e.g., February 2026 Guatemala")
            c1, c2, c3 = st.columns(3)
            with c1:
                trip_month = st.number_input("Month", min_value=1, max_value=12, value=date.today().month)
            with c2:
                trip_year = st.number_input("Year", min_value=2000, max_value=2100, value=date.today().year)
            with c3:
                trip_location = st.text_input("Location", placeholder="e.g., Guatemala")
            c_sub, c_cancel = st.columns(2)
            with c_sub:
                if st.form_submit_button("Create Trip", type="primary", use_container_width=True):
                    if not trip_name:
                        st.error("Please enter a trip name.")
                    else:
                        trip_id = f"{int(trip_month):02d}_{int(trip_year)}"
                        if trip_id in trips:
                            st.error("A trip for that month/year already exists.")
                        else:
                            trips[trip_id] = {
                                'name': trip_name,
                                'month': int(trip_month),
                                'year': int(trip_year),
                                'location': trip_location,
                                'created_at': str(date.today())
                            }
                            save_trips(trips)
                            st.session_state['show_create_trip'] = False
                            st.rerun()
            with c_cancel:
                if st.form_submit_button("Cancel", use_container_width=True):
                    st.session_state['show_create_trip'] = False
                    st.rerun()

    if trips:
        for trip_id, trip in sorted(trips.items(), key=lambda x: (x[1]['year'], x[1]['month']), reverse=True):
            stats = get_trip_stats(trip_id)
            with st.container():
                c1, c2, c3, c4, c5, c6 = st.columns([3, 1, 1, 1, 1, 1])
                with c1:
                    st.markdown(f"**{trip['name']}**")
                    st.caption(f"Created: {trip.get('created_at', 'N/A')}")
                with c2:
                    st.metric("Total", stats['total'])
                with c3:
                    st.metric("Dentist", stats['dentist'])
                with c4:
                    st.metric("Physician", stats['physician'])
                with c5:
                    st.metric("Pediatrician", stats['pediatrician'])
                with c6:
                    if st.button("Open", key=f"open_{trip_id}"):
                        st.session_state.current_trip_id   = trip_id
                        st.session_state.current_trip_name = trip['name']
                        patients = load_trip_patients(trip_id)
                        st.session_state.patients = patients
                        st.session_state.patient_counter = len(patients)
                        st.session_state.page = 'Dashboard'
                        st.rerun()
                st.markdown("---")
    else:
        st.info("No trips yet. Click '+ New Trip' to create your first clinic trip.")

# Sidebar
def render_sidebar():
    with st.sidebar:
        st.markdown("### Humanity First EMR")
        st.markdown(f"**Trip:** {st.session_state.current_trip_name}")
        role_label = st.session_state.role.capitalize()
        if st.session_state.doctor_type:
            role_label += f" ({st.session_state.doctor_type})"
        st.markdown(f"**Role:** {role_label}")
        st.markdown("---")

        if st.session_state.role == 'student':
            nav_options = ["Dashboard", "Patient Forms", "Patient Records", "Search"]
        else:
            nav_options = ["Dashboard", "Patient Forms", "Patient Records",
                           "Visit History", "Data Management", "Search"]

        if st.session_state.get('pending_nav'):
            st.session_state.nav_radio = st.session_state.pending_nav
            st.session_state.pending_nav = None

        page = st.radio("Navigation", nav_options, label_visibility="collapsed",
                        key="nav_radio")

        st.markdown("---")
        st.markdown(f"**Total Patients:** {len(st.session_state.patients)}")
        high_risk = sum(1 for p in st.session_state.patients.values()
                        if p.get('water_risk_rating') == 'High')
        st.markdown(f"**High Risk:** {high_risk}")

        st.markdown("---")
        if st.button("Save Data", use_container_width=True):
            save_patients_to_file()
            st.success("Data saved!")

        st.markdown("---")
        if st.button("Back to Trips", use_container_width=True):
            st.session_state.current_trip_id   = None
            st.session_state.current_trip_name = None
            st.session_state.patients = {}
            st.session_state.patient_counter = 0
            st.rerun()
        if st.button("Logout", use_container_width=True):
            st.session_state.logged_in = False
            st.session_state.role = None
            st.session_state.doctor_type = None
            st.session_state.current_trip_id = None
            st.session_state.current_trip_name = None
            st.session_state.patients = {}
            st.rerun()

    return page

# Dashboard
def render_dashboard():
    st.markdown('<div class="main-header">Humanity First Electronic Medical Records System</div>', unsafe_allow_html=True)
    st.markdown(f"### {st.session_state.current_trip_name}")

    col1, col2, col3, col4 = st.columns(4)
    with col1:
        st.metric("Total Patients", len(st.session_state.patients))
    with col2:
        high_risk = sum(1 for p in st.session_state.patients.values()
                        if p.get('water_risk_rating') == 'High')
        st.metric("High Risk", high_risk)
    with col3:
        diabetic = sum(1 for p in st.session_state.patients.values()
                       if any('Diabetes' in c.get('condition', '') for c in p.get('conditions', [])))
        st.metric("Diabetic Patients", diabetic)
    with col4:
        seen = sum(1 for p in st.session_state.patients.values() if patient_seen_by_doctor(p))
        st.metric("Seen by Doctor", seen)

    st.markdown("---")
    if st.session_state.patients:
        st.markdown("### Recent Patients")
        patients_list = list(st.session_state.patients.items())[-5:]
        patients_list.reverse()
        for patient_id, patient in patients_list:
            with st.container():
                c1, c2, c3, c4 = st.columns([1, 2, 2, 1])
                with c1:
                    if patient.get('photo'):
                        try:
                            st.image(base64_to_image(patient['photo']), width=60)
                        except:
                            st.write("[Photo]")
                    else:
                        st.write("[No Photo]")
                with c2:
                    st.write(f"**{patient['first_name']} {patient['last_name']}**")
                    st.write(f"ID: {patient_id}")
                with c3:
                    dob_str = patient.get('date_of_birth', '')
                    if dob_str:
                        st.write(f"DOB: {format_dob(dob_str)}")
                    st.write(f"Risk: {patient.get('water_risk_rating', 'Not Assessed')}")
                with c4:
                    if st.button("View", key=f"dash_view_{patient_id}"):
                        st.session_state.current_patient_id = patient_id
                        st.session_state.pending_nav = "Patient Records"
                        st.rerun()
                st.markdown("---")
    else:
        st.info("No patients registered yet.")

# Registering a patient

def render_register_patient():
    st.markdown('<div class="main-header">Register New Patient</div>', unsafe_allow_html=True)

    with st.form("patient_registration"):
        st.markdown('<div class="section-header">Personal Information</div>', unsafe_allow_html=True)
        col1, col2 = st.columns(2)
        with col1:
            first_name = st.text_input("First Name *", placeholder="Enter first name")
            last_name  = st.text_input("Last Name *", placeholder="Enter last name")
            dob_col, age_col = st.columns([3, 2])
            with dob_col:
                dob = st.date_input("Date of Birth *", min_value=date(1900,1,1), max_value=date.today(), value=date(1990,1,1))
            with age_col:
                age_unit = st.selectbox("Age Unit", ["Years (2–130)", "Months (1–24)"], key="sb_reg_age_unit")
                age_value = st.number_input("Age", min_value=1, max_value=130, value=30, step=1, key="sb_reg_age_val")
            gender = st.selectbox("Gender", ["Male","Female","Other"], key="sb_gender")
            assigned_doctor_type = st.selectbox("Assign to Doctor Type *",
                ["Dentist", "Physician", "Pediatrician"], key="sb_assigned_doctor")
        with col2:
            phone = st.text_input("Phone Number", placeholder="Enter phone number")
            address = st.text_area("Address", placeholder="Enter full address", height=100)
            emergency_contact = st.text_input("Emergency Contact", placeholder="Name and phone")

        st.markdown('<div class="section-header">Patient Photo</div>', unsafe_allow_html=True)
        uploaded_photo = st.file_uploader("Upload Patient Photo", type=['png','jpg','jpeg'])
        photo_base64 = None
        if uploaded_photo:
            image = Image.open(uploaded_photo)
            image = image.resize((200,200))
            photo_base64 = image_to_base64(image)
            st.image(image, caption="Patient Photo", width=150)

        st.markdown('<div class="section-header">Water Contamination Risk Assessment</div>', unsafe_allow_html=True)
        c1, c2 = st.columns(2)
        with c1:
            water_source = st.selectbox("Primary Water Source",
                ["Municipal/Treated Water","Well Water","River/Stream","Rainwater Collection",
                 "Shared Community Source","Unknown/Untreated"], key="sb_water_source")
        with c2:
            water_risk_rating = st.selectbox("Water Contamination Risk Level",
                ["Low","Medium","High"], key="sb_water_risk_rating")
        water_related_history = st.multiselect("History of Water-Related Conditions", WATER_CONTAMINATION_CONDITIONS)
        water_notes = st.text_area("Water Risk Notes", placeholder="Additional notes about water source or contamination concerns...")

        st.markdown('<div class="section-header">Initial Preexisting Conditions</div>', unsafe_allow_html=True)
        selected_conditions = st.multiselect("Select Known Conditions", PREEXISTING_CONDITIONS)
        conditions_list = []
        if selected_conditions:
            non_none = [c for c in selected_conditions if c != "None"]
            if non_none:
                st.markdown("**Condition Details:**")
            for condition in selected_conditions:
                if condition == "None":
                    conditions_list.append({'condition': 'None', 'diagnosis_date': str(date.today()),
                                            'severity': 'N/A', 'notes': 'No preexisting conditions'})
                    continue
                with st.expander(f"Details for: {condition}"):
                    cc1, cc2 = st.columns(2)
                    with cc1:
                        diag_date = st.date_input("Diagnosis Date", key=f"diag_{condition}", max_value=date.today())
                    with cc2:
                        severity = st.selectbox("Severity", ["Mild","Moderate","Severe"], key=f"sev_{condition}")
                    cnotes = st.text_area("Notes", key=f"notes_{condition}")
                    conditions_list.append({'condition': condition, 'diagnosis_date': str(diag_date),
                                            'severity': severity, 'notes': cnotes})

        submitted = st.form_submit_button("Register Patient", type="primary", use_container_width=True)

        if submitted:
            if not first_name or not last_name:
                st.error("Please fill in required fields (First Name, Last Name)")
            else:
                patient_id = generate_patient_id()
                age = calculate_age(dob)
                trip_visit = {
                    'trip_visit': True,
                    'patient_id': patient_id,
                    'date': str(date.today()),
                    'recorded_at': str(datetime.now()),
                    'doctor_type': None,
                    'vitals': None,
                    'diagnosis_info': None,
                    'medications': []
                }
                st.session_state.patients[patient_id] = {
                    'first_name': first_name,
                    'last_name': last_name,
                    'date_of_birth': str(dob),
                    'age_value': int(age_value),
                    'age_unit': age_unit,
                    'age_at_registration': age,
                    'gender': gender,
                    'phone': phone,
                    'address': address,
                    'emergency_contact': emergency_contact,
                    'photo': photo_base64,
                    'water_source': water_source,
                    'water_risk_rating': water_risk_rating,
                    'water_related_history': water_related_history,
                    'water_notes': water_notes,
                    'conditions': conditions_list,
                    'vital_entries': [],
                    'diabetic_entries': [],
                    'medical_photos': [],
                    'visits': [trip_visit],
                    'medications': [],
                    'diagnosis': {},
                    'assigned_doctor_type': assigned_doctor_type,
                    'registration_date': str(date.today())
                }
                save_patient_record(patient_id)
                st.success(f"Patient registered successfully! ID: {patient_id}")
                st.session_state.current_patient_id = patient_id

# Patient records
def render_patient_records():
    st.markdown('<div class="main-header">Patient Records</div>', unsafe_allow_html=True)
    if not st.session_state.patients:
        st.info("No patients registered yet.")
        return

    role = st.session_state.get('role', 'student')

    c1, c2 = st.columns([2,1])
    with c1:
        search_term = st.text_input("Search Patients", placeholder="Enter name or ID...")
    with c2:
        risk_filter = st.selectbox("Filter by Risk", ["All","High","Medium","Low"], key="sb_risk_filter")

    filtered = {}
    for pid, patient in st.session_state.patients.items():
        name_match = search_term.lower() in f"{patient['first_name']} {patient['last_name']}".lower()
        id_match   = search_term.lower() in pid.lower()
        risk_match = risk_filter == "All" or patient.get('water_risk_rating') == risk_filter
        if (not search_term or name_match or id_match) and risk_match:
            filtered[pid] = patient

    patient_options = {f"{pid} - {p['first_name']} {p['last_name']}": pid for pid, p in filtered.items()}

    if not patient_options:
        st.warning("No patients match the search criteria.")
        return

    selected = st.selectbox("Select Patient", list(patient_options.keys()), key="sb_patient_records")
    patient_id = patient_options[selected]
    patient = st.session_state.patients[patient_id]

    st.markdown("---")
    c1, c2, c3 = st.columns([1,2,2])
    with c1:
        if patient.get('photo'):
            try:
                st.image(base64_to_image(patient['photo']), caption="Patient Photo", width=150)
            except:
                st.write("[No photo]")
        else:
            st.write("[No photo uploaded]")
    with c2:
        st.markdown(f"### {patient['first_name']} {patient['last_name']}")
        st.write(f"**ID:** {patient_id}")
        dob_str = patient.get('date_of_birth', '')
        if dob_str:
            dob_d = parse_dob(dob_str)
            age_str = f" (Age: {calculate_age(dob_d)})" if dob_d else ""
            st.write(f"**DOB:** {format_dob(dob_str)}{age_str}")
        st.write(f"**Gender:** {patient.get('gender','')}")
    with c3:
        st.write(f"**Phone:** {patient.get('phone','N/A')}")
        st.write(f"**Emergency Contact:** {patient.get('emergency_contact','N/A')}")
        st.write(f"**Registered:** {patient.get('registration_date','N/A')}")
        risk = patient.get('water_risk_rating','Not Assessed')
        risk_class = f"risk-{risk.lower()}" if risk in ['High','Medium','Low'] else ""
        st.markdown(f'<div class="{risk_class}"><strong>Water Risk:</strong> {risk}</div>', unsafe_allow_html=True)

    has_diabetic = bool(patient.get('diabetic_entries'))
    tab_names = ["Vital Signs"]
    if has_diabetic:
        tab_names.append("Diabetic Monitoring")
    tab_names += ["Conditions", "Water Risk Details", "Medical Photos", "Visits"]
    if role == 'doctor':
        tab_names.append("Medications")
    tabs_list = st.tabs(tab_names)
    tabs_dict = dict(zip(tab_names, tabs_list))

    # Vital Signs
    with tabs_dict["Vital Signs"]:
        st.markdown("### Vital Signs History")
        entries = patient.get('vital_entries', [])
        if entries:
            for i, entry in enumerate(entries):
                c_info, c_del = st.columns([10,1])
                with c_info:
                    st.write(f"**{entry.get('date','')} {entry.get('time','')}** — BP: {entry.get('blood_pressure','')}, HR: {entry.get('heart_rate','')} bpm, Temp: {entry.get('temperature','')}°C, Weight: {entry.get('weight','')} kg")
                with c_del:
                    with st.container():
                        st.markdown('<div class="delete-btn">', unsafe_allow_html=True)
                        if st.button("×", key=f"del_vital_{patient_id}_{i}", help="Delete this entry"):
                            st.session_state.patients[patient_id]['vital_entries'].pop(i)
                            save_patient_record(patient_id)
                            st.rerun()
                        st.markdown('</div>', unsafe_allow_html=True)

            if len(entries) > 1:
                st.markdown("### Vital Signs Trends")
                chart_df = pd.DataFrame(entries)
                try:
                    chart_df['datetime'] = pd.to_datetime(chart_df['date'] + ' ' + chart_df['time'])
                    chart_df = chart_df.sort_values('datetime')
                    c1, c2 = st.columns(2)
                    with c1:
                        st.markdown("#### Blood Pressure")
                        st.line_chart(chart_df[['datetime','bp_systolic','bp_diastolic']].set_index('datetime'))
                    with c2:
                        st.markdown("#### Heart Rate")
                        st.line_chart(chart_df[['datetime','heart_rate']].set_index('datetime'))
                    c1, c2 = st.columns(2)
                    with c1:
                        st.markdown("#### Weight")
                        st.line_chart(chart_df[['datetime','weight']].set_index('datetime'))
                    with c2:
                        st.markdown("#### BMI")
                        if 'bmi' in chart_df.columns:
                            st.line_chart(chart_df[['datetime','bmi']].set_index('datetime'))
                except Exception:
                    pass
        else:
            st.info("No vital sign entries recorded.")

    # Diabetic (only shown if entries exist)
    if "Diabetic Monitoring" in tabs_dict:
        with tabs_dict["Diabetic Monitoring"]:
            st.markdown("### Diabetic Monitoring History")
            diabetic_entries = patient.get('diabetic_entries', [])
            for i, entry in enumerate(diabetic_entries):
                c_info, c_del = st.columns([10,1])
                with c_info:
                    st.write(f"**{entry.get('date','')} {entry.get('time','')}** — Glucose: {entry.get('blood_glucose','')} mg/dL ({entry.get('glucose_timing','')}), HbA1c: {entry.get('hba1c','N/A')}")
                with c_del:
                    with st.container():
                        st.markdown('<div class="delete-btn">', unsafe_allow_html=True)
                        if st.button("×", key=f"del_diab_{patient_id}_{i}", help="Delete this entry"):
                            st.session_state.patients[patient_id]['diabetic_entries'].pop(i)
                            save_patient_record(patient_id)
                            st.rerun()
                        st.markdown('</div>', unsafe_allow_html=True)
            if len(diabetic_entries) > 1:
                st.markdown("### Diabetic Trends")
                try:
                    chart_df = pd.DataFrame(diabetic_entries)
                    chart_df['datetime'] = pd.to_datetime(chart_df['date'] + ' ' + chart_df['time'])
                    chart_df = chart_df.sort_values('datetime')
                    st.markdown("#### Blood Glucose")
                    st.line_chart(chart_df[['datetime','blood_glucose']].set_index('datetime'))
                except Exception:
                    pass

    # Conditions
    with tabs_dict["Conditions"]:
        st.markdown("### Preexisting Conditions")
        conditions = patient.get('conditions', [])
        if conditions:
            for i, cond in enumerate(conditions):
                c_info, c_del = st.columns([10,1])
                with c_info:
                    with st.expander(f"{cond['condition']} - {cond['severity']}"):
                        st.write(f"**Diagnosis Date:** {cond['diagnosis_date']}")
                        st.write(f"**Severity:** {cond['severity']}")
                        st.write(f"**Notes:** {cond.get('notes','No notes')}")
                with c_del:
                    with st.container():
                        st.markdown('<div class="delete-btn">', unsafe_allow_html=True)
                        if st.button("×", key=f"del_cond_{patient_id}_{i}", help="Delete this condition"):
                            st.session_state.patients[patient_id]['conditions'].pop(i)
                            save_patient_record(patient_id)
                            st.rerun()
                        st.markdown('</div>', unsafe_allow_html=True)
        else:
            st.info("No preexisting conditions recorded.")

    # Water Risk
    with tabs_dict["Water Risk Details"]:
        st.markdown("### Water Contamination Risk Details")
        st.write(f"**Water Source:** {patient.get('water_source','Not specified')}")
        st.write(f"**Risk Rating:** {patient.get('water_risk_rating','Not assessed')}")
        for condition in patient.get('water_related_history', []):
            st.write(f"  - {condition}")
        if patient.get('water_notes'):
            st.write(f"**Notes:** {patient['water_notes']}")

    # Medical Photos
    with tabs_dict["Medical Photos"]:
        st.markdown("### Medical Photos & Documents")
        medical_photos = patient.get('medical_photos', [])
        if medical_photos:
            cols = st.columns(3)
            for idx, photo_data in enumerate(medical_photos):
                with cols[idx % 3]:
                    try:
                        st.image(base64_to_image(photo_data['image']),
                                 caption=f"{photo_data.get('description','')} - {photo_data.get('date','')}", width=200)
                    except:
                        st.write("Unable to display image")
                    with st.container():
                        st.markdown('<div class="delete-btn">', unsafe_allow_html=True)
                        if st.button("× remove photo", key=f"del_photo_{patient_id}_{idx}"):
                            st.session_state.patients[patient_id]['medical_photos'].pop(idx)
                            save_patient_record(patient_id)
                            st.rerun()
                        st.markdown('</div>', unsafe_allow_html=True)
        else:
            st.info("No medical photos uploaded.")

    # Visits
    with tabs_dict["Visits"]:
        st.markdown("### Visit History")
        visits = patient.get('visits', [])
        for i, visit in enumerate(sorted(visits, key=lambda x: x.get('date',''), reverse=True)):
            if visit.get('trip_visit'):
                label = f"Trip Visit — {visit.get('date','N/A')}"
                with st.expander(label, expanded=True):
                    st.write(f"**Patient ID:** {visit.get('patient_id','')}")
                    if visit.get('doctor_type'):
                        st.write(f"**Doctor Type:** {visit['doctor_type']}")
                    if visit.get('vitals'):
                        v = visit['vitals']
                        st.write(f"**BP:** {v.get('blood_pressure','')} | **HR:** {v.get('heart_rate','')} bpm | **Temp:** {v.get('temperature','')}°C | **Weight:** {v.get('weight','')} kg")
                    if visit.get('diagnosis_info'):
                        d = visit['diagnosis_info']
                        st.write(f"**Chief Complaint:** {d.get('chief_complaint','')}")
                        st.write(f"**Diagnosis:** {d.get('diagnosis','')}")
                        st.write(f"**Treatment:** {d.get('treatment','')}")
                    meds = visit.get('medications', [])
                    if meds:
                        st.write("**Medications:** " + ", ".join(m.get('medication','') for m in meds))
            else:
                with st.expander(f"{visit.get('date','N/A')} — {visit.get('visit_type','General')}"):
                    st.write(f"**Chief Complaint:** {visit.get('chief_complaint','')}")
                    st.write(f"**Diagnosis:** {visit.get('diagnosis','')}")
                    st.write(f"**Treatment:** {visit.get('treatment','')}")
                    st.write(f"**Notes:** {visit.get('notes','')}")
                    with st.container():
                        st.markdown('<div class="delete-btn">', unsafe_allow_html=True)
                        if st.button("× remove visit", key=f"del_visit_{patient_id}_{i}"):
                            st.session_state.patients[patient_id]['visits'].pop(i)
                            save_patient_record(patient_id)
                            st.rerun()
                        st.markdown('</div>', unsafe_allow_html=True)

    # Medications (Doctor only, read-only view in Patient Records)
    if "Medications" in tabs_dict:
        with tabs_dict["Medications"]:
            st.markdown("### Current Medications")
            medications = patient.get('medications', [])
            if medications:
                active_meds   = [m for m in medications if m.get('status') == 'Active']
                inactive_meds = [m for m in medications if m.get('status') != 'Active']
                if active_meds:
                    st.markdown("#### Active Medications")
                    for med in active_meds:
                        with st.expander(f"{med['medication']} - {med['dosage']}"):
                            st.write(f"**Frequency:** {med.get('frequency','N/A')}")
                            st.write(f"**Start Date:** {med.get('start_date','N/A')}")
                            st.write(f"**Prescribed For:** {med.get('prescribed_for','N/A')}")
                            st.write(f"**Notes:** {med.get('notes','')}")
                if inactive_meds:
                    st.markdown("#### Discontinued Medications")
                    for med in inactive_meds:
                        with st.expander(f"[Discontinued] {med['medication']} - {med['dosage']}"):
                            st.write(f"**Frequency:** {med.get('frequency','N/A')}")
                            st.write(f"**Start Date:** {med.get('start_date','N/A')}")
                            st.write(f"**End Date:** {med.get('end_date','N/A')}")
                            st.write(f"**Reason Discontinued:** {med.get('discontinue_reason','N/A')}")
            else:
                st.info("No medications recorded.")

    # Discreet delete patient
    st.markdown("---")
    with st.expander("⋯ Patient Record Actions", expanded=False):
        st.warning("Deleting a patient record is permanent and will renumber all IDs in this trip.")
        confirm_del = st.text_input("Type patient ID to confirm deletion", key=f"confirm_del_{patient_id}")
        if st.button("Delete Patient Record", key=f"del_patient_{patient_id}"):
            if confirm_del.strip() == patient_id:
                delete_patient_and_renumber(patient_id)
                st.success("Patient record deleted and IDs renumbered.")
                st.rerun()
            else:
                st.error("Patient ID does not match. Deletion cancelled.")

# Adding a medical entry
def render_add_medical_entry():
    st.markdown('<div class="main-header">Add Medical Entry</div>', unsafe_allow_html=True)
    if not st.session_state.patients:
        st.info("No patients registered yet. Please register a patient first.")
        return

    role = st.session_state.get('role', 'student')
    patient_options = {f"{pid} - {p['first_name']} {p['last_name']}": pid
                       for pid, p in st.session_state.patients.items()}
    option_keys = list(patient_options.keys())
    most_recent_pid = max(st.session_state.patients.keys(),
                          key=lambda pid: st.session_state.patients[pid].get('registration_date', ''))
    most_recent_label = f"{most_recent_pid} - {st.session_state.patients[most_recent_pid]['first_name']} {st.session_state.patients[most_recent_pid]['last_name']}"
    default_idx = option_keys.index(most_recent_label) if most_recent_label in option_keys else 0
    selected = st.selectbox("Select Patient", option_keys, index=default_idx, key="sb_add_medical_patient")
    patient_id = patient_options[selected]
    patient = st.session_state.patients[patient_id]
    st.markdown(f"### Adding entry for: {patient['first_name']} {patient['last_name']}")

    entry_types = ["Vital Signs","Diabetic Monitoring","Add Condition","Upload Medical Photo"]
    entry_type = st.radio("Entry Type", entry_types, horizontal=True)
    st.markdown("---")

    # Vital Signs
    if entry_type == "Vital Signs":
        with st.form("vital_signs_form"):
            st.markdown('<div class="section-header">Vital Signs Entry</div>', unsafe_allow_html=True)
            entry_date = st.date_input("Date", value=date.today())
            entry_time = st.time_input("Time")
            c1, c2 = st.columns(2)
            with c1:
                bp_systolic = st.number_input("Blood Pressure - Systolic (mmHg)", min_value=60, max_value=250, value=120)
                bp_diastolic = st.number_input("Blood Pressure - Diastolic (mmHg)", min_value=40, max_value=150, value=80)
                heart_rate = st.number_input("Heart Rate (bpm)", min_value=30, max_value=200, value=72)
            with c2:
                temperature = st.number_input("Temperature (°C)", min_value=35.0, max_value=42.0, value=37.0, step=0.1)
                weight_input = st.number_input("Weight", min_value=1.0, max_value=660.0, value=154.0, step=0.1)
                weight_unit = st.radio("Weight Unit", ["lbs","kg"], horizontal=True, key="vital_weight_unit")
                height = st.number_input("Height (cm)", min_value=50, max_value=250, value=170)
            respiratory_rate = st.number_input("Respiratory Rate (breaths/min)", min_value=8, max_value=40, value=16)
            notes = st.text_area("Notes", placeholder="Additional observations...")
            if st.form_submit_button("Save Vital Signs", type="primary", use_container_width=True):
                weight_kg  = round(weight_input * 0.453592, 1) if weight_unit == "lbs" else weight_input
                weight_lbs = round(weight_input, 1) if weight_unit == "lbs" else round(weight_input / 0.453592, 1)
                bmi = round(weight_kg / ((height/100)**2), 1) if height > 0 else 0
                entry = {
                    'date': str(entry_date), 'time': str(entry_time),
                    'bp_systolic': bp_systolic, 'bp_diastolic': bp_diastolic,
                    'blood_pressure': f"{bp_systolic}/{bp_diastolic}",
                    'heart_rate': heart_rate, 'temperature': temperature,
                    'weight': weight_kg, 'weight_lbs': weight_lbs,
                    'height': height, 'bmi': bmi,
                    'respiratory_rate': respiratory_rate, 'notes': notes
                }
                st.session_state.patients[patient_id]['vital_entries'].append(entry)
                sync_vitals_to_trip_visit(patient_id, entry)
                save_patient_record(patient_id)
                st.success("Vital signs saved successfully!")

    # Diabetic Monitoring
    elif entry_type == "Diabetic Monitoring":
        with st.form("diabetic_form"):
            st.markdown('<div class="section-header">Diabetic Monitoring Entry</div>', unsafe_allow_html=True)
            entry_date = st.date_input("Date", value=date.today())
            entry_time = st.time_input("Time")
            st.markdown("#### Blood Glucose")
            c1, c2 = st.columns(2)
            with c1:
                blood_glucose = st.number_input("Blood Glucose Level (mg/dL)", min_value=20, max_value=600, value=100)
            with c2:
                glucose_timing = st.selectbox("Measurement Timing",
                    ["Fasting","Before Meal","After Meal (2 hrs)","Random","Bedtime"], key="sb_glucose_timing")
            st.markdown("#### Insulin")
            c1, c2 = st.columns(2)
            with c1:
                insulin_type = st.selectbox("Insulin Type",
                    ["None","Rapid-acting","Short-acting","Intermediate-acting","Long-acting","Mixed"], key="sb_insulin_type")
            with c2:
                insulin_dose = st.number_input("Insulin Dose (units)", min_value=0, max_value=100, value=0)
            st.markdown("#### Blood Pressure")
            c1, c2 = st.columns(2)
            with c1:
                bp_systolic = st.number_input("Systolic (mmHg)", min_value=60, max_value=250, value=120)
            with c2:
                bp_diastolic = st.number_input("Diastolic (mmHg)", min_value=40, max_value=150, value=80)
            st.markdown("#### Cholesterol Panel")
            c1, c2, c3 = st.columns(3)
            with c1:
                total_cholesterol = st.number_input("Total Cholesterol (mg/dL)", min_value=0, max_value=500, value=0)
                ldl = st.number_input("LDL (mg/dL)", min_value=0, max_value=300, value=0)
            with c2:
                hdl = st.number_input("HDL (mg/dL)", min_value=0, max_value=150, value=0)
                triglycerides = st.number_input("Triglycerides (mg/dL)", min_value=0, max_value=1000, value=0)
            with c3:
                hba1c = st.number_input("HbA1c (%)", min_value=0.0, max_value=20.0, value=0.0, step=0.1)
            notes = st.text_area("Notes", placeholder="Additional observations, symptoms, diet notes...")
            if st.form_submit_button("Save Diabetic Entry", type="primary", use_container_width=True):
                entry = {
                    'date': str(entry_date), 'time': str(entry_time),
                    'blood_glucose': blood_glucose, 'glucose_timing': glucose_timing,
                    'insulin_type': insulin_type, 'insulin_dose': insulin_dose,
                    'bp_systolic': bp_systolic, 'bp_diastolic': bp_diastolic,
                    'blood_pressure': f"{bp_systolic}/{bp_diastolic}",
                    'total_cholesterol': total_cholesterol if total_cholesterol > 0 else None,
                    'ldl': ldl if ldl > 0 else None,
                    'hdl': hdl if hdl > 0 else None,
                    'triglycerides': triglycerides if triglycerides > 0 else None,
                    'hba1c': hba1c if hba1c > 0 else None,
                    'notes': notes
                }
                st.session_state.patients[patient_id]['diabetic_entries'].append(entry)
                save_patient_record(patient_id)
                st.success("Diabetic monitoring entry saved successfully!")

    # Add Condition
    elif entry_type == "Add Condition":
        st.markdown('<div class="section-header">Add Preexisting Condition</div>', unsafe_allow_html=True)
        condition = st.selectbox("Condition", PREEXISTING_CONDITIONS, key="sb_condition")
        custom_condition = ""
        if condition == "Other":
            custom_condition = st.text_input("Specify Condition", placeholder="Enter condition name...")
        with st.form("condition_form"):
            c1, c2 = st.columns(2)
            with c1:
                diagnosis_date = st.date_input("Diagnosis Date", max_value=date.today())
            with c2:
                severity = st.selectbox("Severity", ["Mild","Moderate","Severe"], key="sb_condition_severity")
            notes = st.text_area("Notes", placeholder="Additional details about the condition...")
            if st.form_submit_button("Add Condition", type="primary", use_container_width=True):
                final_condition = custom_condition if condition == "Other" and custom_condition else condition
                new_condition = {'condition': final_condition, 'diagnosis_date': str(diagnosis_date),
                                 'severity': severity, 'notes': notes}
                st.session_state.patients[patient_id]['conditions'].append(new_condition)
                save_patient_record(patient_id)
                st.success(f"Condition '{final_condition}' added successfully!")

    # Upload Medical Photo
    elif entry_type == "Upload Medical Photo":
        with st.form("photo_form"):
            st.markdown('<div class="section-header">Upload Medical Photo</div>', unsafe_allow_html=True)
            uploaded_file = st.file_uploader("Select Image", type=['png','jpg','jpeg'])
            photo_date = st.date_input("Date Taken", value=date.today())
            description = st.text_input("Description", placeholder="e.g., Wound on left arm, X-ray results...")
            category = st.selectbox("Category",
                ["General","Wound/Injury","Skin Condition","X-Ray","Lab Results","Other Documentation"],
                key="sb_photo_category")
            notes = st.text_area("Notes", placeholder="Additional details...")
            if uploaded_file:
                st.image(Image.open(uploaded_file), caption="Preview", width=300)
            if st.form_submit_button("Upload Photo", type="primary", use_container_width=True):
                if uploaded_file:
                    image = Image.open(uploaded_file)
                    image.thumbnail((800,800), Image.Resampling.LANCZOS)
                    photo_entry = {'image': image_to_base64(image), 'date': str(photo_date),
                                   'description': description, 'category': category, 'notes': notes}
                    st.session_state.patients[patient_id]['medical_photos'].append(photo_entry)
                    save_patient_record(patient_id)
                    st.success("Medical photo uploaded successfully!")
                else:
                    st.error("Please select an image to upload.")

# Diagnosis = Doctor only
def render_diagnosis():
    st.markdown('<div class="main-header">Diagnosis</div>', unsafe_allow_html=True)
    if not st.session_state.patients:
        st.info("No patients registered yet. Please register a patient first.")
        return

    patient_options = {f"{pid} - {p['first_name']} {p['last_name']}": pid
                       for pid, p in st.session_state.patients.items()}
    selected = st.selectbox("Select Patient", list(patient_options.keys()), key="sb_diag_patient")
    patient_id = patient_options[selected]
    patient = st.session_state.patients[patient_id]
    st.markdown(f"### Diagnosis for: {patient['first_name']} {patient['last_name']}")

    existing = patient.get('diagnosis', {})
    if existing:
        st.info(f"Existing diagnosis on file — Chief Complaint: {existing.get('chief_complaint','')}")

    with st.form("diagnosis_form"):
        st.markdown('<div class="section-header">Clinical Diagnosis</div>', unsafe_allow_html=True)
        chief_complaint = st.text_input("Chief Complaint",
            value=existing.get('chief_complaint',''), placeholder="Main reason for visit...")
        diagnosis_text = st.text_area("Diagnosis",
            value=existing.get('diagnosis',''), placeholder="Doctor's diagnosis...")
        treatment = st.text_area("Treatment Plan",
            value=existing.get('treatment',''), placeholder="Treatment prescribed...")

        if st.form_submit_button("Save Diagnosis", type="primary", use_container_width=True):
            sync_diagnosis_to_trip_visit(patient_id, chief_complaint, diagnosis_text, treatment)
            sync_doctor_type_to_trip_visit(patient_id)
            save_patient_record(patient_id)
            st.success("Diagnosis saved and synced to visit record.")

# Visit History
def render_visit_history():
    st.markdown('<div class="main-header">Visit History</div>', unsafe_allow_html=True)
    if not st.session_state.patients:
        st.info("No patients registered yet. Please register a patient first.")
        return

    patient_options = {f"{pid} - {p['first_name']} {p['last_name']}": pid
                       for pid, p in st.session_state.patients.items()}
    selected = st.selectbox("Select Patient", list(patient_options.keys()), key="sb_visit_patient")
    patient_id = patient_options[selected]
    patient = st.session_state.patients[patient_id]
    st.markdown(f"### Visit History for: {patient['first_name']} {patient['last_name']}")

    existing_diag = patient.get('diagnosis', {})
    if not isinstance(existing_diag, dict):
        existing_diag = {}
    prefill_chief    = existing_diag.get('chief_complaint', '')
    prefill_diag     = existing_diag.get('diagnosis', '')
    prefill_treatment = existing_diag.get('treatment', '')
    active_meds      = [m for m in patient.get('medications', []) if m.get('status') == 'Active']
    prefill_notes    = ('Medications: ' + '; '.join(
        f"{m.get('medication','')} {m.get('dosage','')} ({m.get('frequency','')})"
        for m in active_meds
    )) if active_meds else ''

    c1, c2 = st.columns([1,1])
    with c1:
        st.markdown("### Add New Visit")
        with st.form("visit_form"):
            visit_date = st.date_input("Visit Date", value=date.today())
            visit_time = st.time_input("Visit Time")
            visit_type = st.selectbox("Visit Type",
                ["Regular Checkup","Follow-up","Emergency","Consultation","Procedure","Lab Work"],
                key="sb_visit_type")
            chief_complaint = st.text_input("Chief Complaint", value=prefill_chief,
                placeholder="Main reason for visit...")
            symptoms = st.text_area("Symptoms", placeholder="Describe current symptoms...")
            diagnosis = st.text_input("Diagnosis", value=prefill_diag,
                placeholder="Doctor's diagnosis...")
            treatment = st.text_area("Treatment Plan", value=prefill_treatment,
                placeholder="Treatment prescribed...")
            follow_up_date = st.date_input("Follow-up Date", value=None, min_value=date.today())
            notes = st.text_area("Additional Notes", value=prefill_notes,
                placeholder="Any other observations...")
            if st.form_submit_button("Save Visit", type="primary", use_container_width=True):
                visit_entry = {
                    'date': str(visit_date), 'time': str(visit_time),
                    'visit_type': visit_type, 'chief_complaint': chief_complaint,
                    'symptoms': symptoms, 'diagnosis': diagnosis, 'treatment': treatment,
                    'follow_up_date': str(follow_up_date) if follow_up_date else None,
                    'notes': notes, 'recorded_at': str(datetime.now())
                }
                st.session_state.patients[patient_id]['visits'].append(visit_entry)
                save_patient_record(patient_id)
                st.success("Visit recorded successfully!")
                st.rerun()

    with c2:
        st.markdown("### Previous Visits")
        visits = patient.get('visits', [])
        if visits:
            for i, visit in enumerate(sorted(visits, key=lambda x: x.get('date',''), reverse=True)):
                if visit.get('trip_visit'):
                    with st.expander(f"Trip Visit — {visit.get('date','N/A')}", expanded=False):
                        if visit.get('doctor_type'):
                            st.write(f"**Doctor Type:** {visit['doctor_type']}")
                        if visit.get('vitals'):
                            v = visit['vitals']
                            st.write(f"**BP:** {v.get('blood_pressure','')} | **HR:** {v.get('heart_rate','')} bpm")
                        if visit.get('diagnosis_info'):
                            d = visit['diagnosis_info']
                            st.write(f"**Diagnosis:** {d.get('diagnosis','')}")
                        meds = visit.get('medications', [])
                        if meds:
                            st.write("**Medications:** " + ", ".join(m.get('medication','') for m in meds))
                else:
                    with st.expander(f"{visit.get('date','N/A')} — {visit.get('visit_type','General')}"):
                        st.write(f"**Chief Complaint:** {visit.get('chief_complaint','')}")
                        st.write(f"**Diagnosis:** {visit.get('diagnosis','')}")
                        st.write(f"**Treatment:** {visit.get('treatment','')}")
                        st.write(f"**Notes:** {visit.get('notes','')}")
                        with st.container():
                            st.markdown('<div class="delete-btn">', unsafe_allow_html=True)
                            if st.button("× remove", key=f"vh_del_{patient_id}_{i}"):
                                st.session_state.patients[patient_id]['visits'].pop(i)
                                save_patient_record(patient_id)
                                st.rerun()
                            st.markdown('</div>', unsafe_allow_html=True)
        else:
            st.info("No previous visits recorded.")

# Medications (Doctor only)
def render_medications():
    st.markdown('<div class="main-header">Medication Management</div>', unsafe_allow_html=True)
    if not st.session_state.patients:
        st.info("No patients registered yet. Please register a patient first.")
        return

    patient_options = {f"{pid} - {p['first_name']} {p['last_name']}": pid
                       for pid, p in st.session_state.patients.items()}
    selected = st.selectbox("Select Patient", list(patient_options.keys()), key="sb_medications_patient")
    patient_id = patient_options[selected]
    patient = st.session_state.patients[patient_id]
    st.markdown(f"### Medications for: {patient['first_name']} {patient['last_name']}")

    tab1, tab2 = st.tabs(["Add Medication","Manage Medications"])

    with tab1:
        st.markdown('<div class="section-header">Prescribe New Medication</div>', unsafe_allow_html=True)
        medication_select = st.selectbox("Medication", COMMON_MEDICATIONS, key="sb_medication_select")
        medication_custom = ""
        if medication_select == "Other":
            medication_custom = st.text_input("Type Medication Name", placeholder="Enter medication name...")

        with st.form("medication_form"):
            c1, c2 = st.columns(2)
            with c1:
                dosage = st.text_input("Dosage", placeholder="e.g., 500mg, 10ml")
                frequency = st.selectbox("Frequency",
                    ["Once daily","Twice daily","Three times daily","Four times daily",
                     "Every 8 hours","Every 12 hours","As needed","Weekly","Monthly"],
                    key="sb_med_frequency")
            with c2:
                route = st.selectbox("Route",
                    ["Oral","Injection","Topical","Inhaled","Sublingual","IV","Other"],
                    key="sb_med_route")
                start_date = st.date_input("Start Date", value=date.today())
                prescribed_for = st.text_input("Prescribed For", placeholder="Condition being treated...")
            instructions = st.text_area("Special Instructions", placeholder="Take with food, avoid alcohol, etc...")
            notes = st.text_area("Notes", placeholder="Additional notes...")

            if st.form_submit_button("Add Medication", type="primary", use_container_width=True):
                medication = medication_custom if medication_select == "Other" and medication_custom else medication_select
                med_entry = {
                    'medication': medication, 'dosage': dosage, 'frequency': frequency,
                    'route': route, 'start_date': str(start_date), 'end_date': None,
                    'prescribed_for': prescribed_for, 'instructions': instructions,
                    'notes': notes, 'status': 'Active', 'discontinue_reason': None
                }
                st.session_state.patients[patient_id]['medications'].append(med_entry)
                sync_doctor_type_to_trip_visit(patient_id)
                sync_medication_to_trip_visit(patient_id)
                auto_save_doctor_visit(patient_id)
                save_patient_record(patient_id)
                st.success(f"Medication '{medication}' added successfully!")

    with tab2:
        medications = patient.get('medications', [])
        if medications:
            active_meds   = [m for m in medications if m.get('status') == 'Active']
            inactive_meds = [m for m in medications if m.get('status') != 'Active']

            if active_meds:
                st.markdown("### Active Medications")
                for idx, med in enumerate(active_meds):
                    c1, c2, c3, c4 = st.columns([3,1,1,1])
                    with c1:
                        st.markdown(f"**{med['medication']}** - {med['dosage']} ({med['frequency']})")
                        st.write(f"Started: {med.get('start_date','N/A')} | For: {med.get('prescribed_for','N/A')}")
                    with c2:
                        if st.button("Details", key=f"view_med_{idx}"):
                            st.write(f"Route: {med.get('route','N/A')}")
                            st.write(f"Instructions: {med.get('instructions','None')}")
                    with c3:
                        if st.button("Discontinue", key=f"disc_med_{idx}"):
                            st.session_state[f"show_disc_{idx}"] = True
                    with c4:
                        with st.container():
                            st.markdown('<div class="delete-btn">', unsafe_allow_html=True)
                            if st.button("×", key=f"del_med_{idx}", help="Delete medication"):
                                all_meds = st.session_state.patients[patient_id]['medications']
                                active_only = [m for m in all_meds if m.get('status') == 'Active']
                                med_to_del = active_only[idx]
                                st.session_state.patients[patient_id]['medications'] = [
                                    m for m in all_meds if m is not med_to_del
                                ]
                                sync_medication_to_trip_visit(patient_id)
                                auto_save_doctor_visit(patient_id)
                                save_patient_record(patient_id)
                                st.rerun()
                            st.markdown('</div>', unsafe_allow_html=True)

                    if st.session_state.get(f"show_disc_{idx}"):
                        with st.form(f"disc_form_{idx}"):
                            reason = st.text_input("Reason for discontinuation")
                            end_date = st.date_input("End Date", value=date.today())
                            if st.form_submit_button("Confirm Discontinue"):
                                for m in st.session_state.patients[patient_id]['medications']:
                                    if m['medication'] == med['medication'] and m['start_date'] == med['start_date']:
                                        m['status'] = 'Discontinued'
                                        m['end_date'] = str(end_date)
                                        m['discontinue_reason'] = reason
                                        break
                                sync_medication_to_trip_visit(patient_id)
                                auto_save_doctor_visit(patient_id)
                                save_patient_record(patient_id)
                                st.session_state[f"show_disc_{idx}"] = False
                                st.success("Medication discontinued.")
                                st.rerun()
                    st.markdown("---")

            if inactive_meds:
                st.markdown("### Discontinued Medications")
                for idx, med in enumerate(inactive_meds):
                    c_exp, c_del = st.columns([10,1])
                    with c_exp:
                        with st.expander(f"[Discontinued] {med['medication']} - {med['dosage']}"):
                            st.write(f"**Frequency:** {med.get('frequency','N/A')}")
                            st.write(f"**Start Date:** {med.get('start_date','N/A')}")
                            st.write(f"**End Date:** {med.get('end_date','N/A')}")
                            st.write(f"**Reason Discontinued:** {med.get('discontinue_reason','N/A')}")
                    with c_del:
                        with st.container():
                            st.markdown('<div class="delete-btn">', unsafe_allow_html=True)
                            if st.button("×", key=f"del_disc_med_{idx}", help="Delete record"):
                                all_meds = st.session_state.patients[patient_id]['medications']
                                inactive_only = [m for m in all_meds if m.get('status') != 'Active']
                                med_to_del = inactive_only[idx]
                                st.session_state.patients[patient_id]['medications'] = [
                                    m for m in all_meds if m is not med_to_del
                                ]
                                save_patient_record(patient_id)
                                st.rerun()
                            st.markdown('</div>', unsafe_allow_html=True)
        else:
            st.info("No medications recorded for this patient.")

# Dcotor Patinet List - Individual
def render_doctor_patient_detail(patient_id):
    patient = st.session_state.patients[patient_id]

    c1, c2, c3 = st.columns([1, 2, 2])
    with c1:
        if patient.get('photo'):
            try:
                st.image(base64_to_image(patient['photo']), caption="Patient Photo", width=150)
            except:
                st.write("[Photo unavailable]")
        else:
            st.write("[No photo uploaded]")
    with c2:
        st.markdown(f"### {patient['first_name']} {patient['last_name']}")
        st.write(f"**ID:** {patient_id}")
        dob_str = patient.get('date_of_birth', '')
        if dob_str:
            dob_d = parse_dob(dob_str)
            age_str = f" (Age: {calculate_age(dob_d)})" if dob_d else ""
            st.write(f"**DOB:** {format_dob(dob_str)}{age_str}")
        st.write(f"**Gender:** {patient.get('gender','')}")
    with c3:
        st.write(f"**Phone:** {patient.get('phone','N/A')}")
        st.write(f"**Emergency Contact:** {patient.get('emergency_contact','N/A')}")
        risk = patient.get('water_risk_rating', 'Not Assessed')
        risk_class = f"risk-{risk.lower()}" if risk in ['High','Medium','Low'] else ""
        st.markdown(f'<div class="{risk_class}"><strong>Water Risk:</strong> {risk}</div>', unsafe_allow_html=True)
    st.markdown("---")

    has_diabetic = bool(patient.get('diabetic_entries'))
    tab_names = ["Vital Signs"]
    if has_diabetic:
        tab_names.append("Diabetic Monitoring")
    tab_names += ["Conditions", "Water Risk Details", "Medical Photos", "Visits", "Diagnosis", "Medications"]
    tabs_list = st.tabs(tab_names)
    tabs_dict = dict(zip(tab_names, tabs_list))

    with tabs_dict["Vital Signs"]:
        st.markdown("### Vital Signs History")
        entries = patient.get('vital_entries', [])
        if entries:
            for entry in entries:
                st.write(f"**{entry.get('date','')} {entry.get('time','')}** — BP: {entry.get('blood_pressure','')}, HR: {entry.get('heart_rate','')} bpm, Temp: {entry.get('temperature','')}°C, Weight: {entry.get('weight','')} kg")
        else:
            st.info("No vital sign entries recorded.")

    if "Diabetic Monitoring" in tabs_dict:
        with tabs_dict["Diabetic Monitoring"]:
            st.markdown("### Diabetic Monitoring History")
            for entry in patient.get('diabetic_entries', []):
                st.write(f"**{entry.get('date','')} {entry.get('time','')}** — Glucose: {entry.get('blood_glucose','')} mg/dL ({entry.get('glucose_timing','')}), HbA1c: {entry.get('hba1c','N/A')}")

    with tabs_dict["Conditions"]:
        st.markdown("### Preexisting Conditions")
        conditions = patient.get('conditions', [])
        if conditions:
            for cond in conditions:
                with st.expander(f"{cond['condition']} - {cond.get('severity','')}"):
                    st.write(f"**Diagnosis Date:** {cond.get('diagnosis_date','')}")
                    st.write(f"**Severity:** {cond.get('severity','')}")
                    st.write(f"**Notes:** {cond.get('notes','')}")
        else:
            st.info("No preexisting conditions recorded.")

    with tabs_dict["Water Risk Details"]:
        st.markdown("### Water Contamination Risk Details")
        st.write(f"**Water Source:** {patient.get('water_source','Not specified')}")
        st.write(f"**Risk Rating:** {patient.get('water_risk_rating','Not assessed')}")
        for c in patient.get('water_related_history', []):
            st.write(f"  - {c}")
        if patient.get('water_notes'):
            st.write(f"**Notes:** {patient['water_notes']}")

    with tabs_dict["Medical Photos"]:
        st.markdown("### Medical Photos & Documents")
        medical_photos = patient.get('medical_photos', [])
        if medical_photos:
            cols = st.columns(3)
            for idx, photo_data in enumerate(medical_photos):
                with cols[idx % 3]:
                    try:
                        st.image(base64_to_image(photo_data['image']),
                                 caption=f"{photo_data.get('description','')} - {photo_data.get('date','')}", width=200)
                    except:
                        st.write("Unable to display image")
        else:
            st.info("No medical photos uploaded.")

    with tabs_dict["Visits"]:
        st.markdown("### Visit History")
        visits = patient.get('visits', [])
        for visit in sorted(visits, key=lambda x: x.get('date',''), reverse=True):
            if visit.get('trip_visit'):
                with st.expander(f"Trip Visit — {visit.get('date','N/A')}", expanded=True):
                    if visit.get('doctor_type'):
                        st.write(f"**Doctor Type:** {visit['doctor_type']}")
                    if visit.get('vitals'):
                        v = visit['vitals']
                        st.write(f"**BP:** {v.get('blood_pressure','')} | **HR:** {v.get('heart_rate','')} bpm | **Temp:** {v.get('temperature','')}°C | **Weight:** {v.get('weight','')} kg")
                    if visit.get('diagnosis_info'):
                        d = visit['diagnosis_info']
                        st.write(f"**Chief Complaint:** {d.get('chief_complaint','')}")
                        st.write(f"**Diagnosis:** {d.get('diagnosis','')}")
                        st.write(f"**Treatment:** {d.get('treatment','')}")
                    meds = visit.get('medications', [])
                    if meds:
                        st.write("**Medications:** " + ", ".join(m.get('medication','') for m in meds))
            else:
                with st.expander(f"{visit.get('date','N/A')} — {visit.get('visit_type','General')}"):
                    st.write(f"**Chief Complaint:** {visit.get('chief_complaint','')}")
                    st.write(f"**Diagnosis:** {visit.get('diagnosis','')}")

    with tabs_dict["Diagnosis"]:
        existing = patient.get('diagnosis', {})
        if existing and existing.get('diagnosis'):
            st.info(f"Existing diagnosis on record: {existing.get('chief_complaint','')}")
        with st.form(f"doc_diag_form_{patient_id}"):
            st.markdown('<div class="section-header">Clinical Diagnosis</div>', unsafe_allow_html=True)
            chief_complaint = st.text_input("Chief Complaint",
                value=existing.get('chief_complaint',''), placeholder="Main reason for visit...")
            diagnosis_text = st.text_area("Diagnosis",
                value=existing.get('diagnosis',''), placeholder="Doctor's diagnosis...")
            treatment = st.text_area("Treatment Plan",
                value=existing.get('treatment',''), placeholder="Treatment prescribed...")
            if st.form_submit_button("Save Diagnosis", type="primary", use_container_width=True):
                sync_diagnosis_to_trip_visit(patient_id, chief_complaint, diagnosis_text, treatment)
                sync_doctor_type_to_trip_visit(patient_id)
                save_patient_record(patient_id)
                st.success("Diagnosis saved and synced to visit record.")
                st.rerun()

    with tabs_dict["Medications"]:
        st.markdown("### Medications")
        medication_select = st.selectbox("Medication", COMMON_MEDICATIONS,
            key=f"doc_med_sel_{patient_id}")
        medication_custom = ""
        if medication_select == "Other":
            medication_custom = st.text_input("Type Medication Name",
                key=f"doc_med_custom_{patient_id}")
        with st.form(f"doc_med_form_{patient_id}"):
            c1, c2 = st.columns(2)
            with c1:
                dosage = st.text_input("Dosage", placeholder="e.g., 500mg")
                frequency = st.selectbox("Frequency",
                    ["Once daily","Twice daily","Three times daily","Four times daily",
                     "Every 8 hours","Every 12 hours","As needed","Weekly","Monthly"],
                    key=f"doc_med_freq_{patient_id}")
            with c2:
                route = st.selectbox("Route",
                    ["Oral","Injection","Topical","Inhaled","Sublingual","IV","Other"],
                    key=f"doc_med_route_{patient_id}")
                start_date = st.date_input("Start Date", value=date.today())
                prescribed_for = st.text_input("Prescribed For",
                    placeholder="Condition being treated...")
            notes = st.text_area("Notes", placeholder="Additional notes...")
            if st.form_submit_button("Add Medication", type="primary", use_container_width=True):
                medication = (medication_custom if medication_select == "Other" and medication_custom
                              else medication_select)
                med_entry = {
                    'medication': medication, 'dosage': dosage, 'frequency': frequency,
                    'route': route, 'start_date': str(start_date), 'end_date': None,
                    'prescribed_for': prescribed_for, 'instructions': '', 'notes': notes,
                    'status': 'Active', 'discontinue_reason': None
                }
                st.session_state.patients[patient_id]['medications'].append(med_entry)
                sync_doctor_type_to_trip_visit(patient_id)
                sync_medication_to_trip_visit(patient_id)
                auto_save_doctor_visit(patient_id)
                save_patient_record(patient_id)
                st.success("Medication added!")
                st.rerun()
        medications = patient.get('medications', [])
        if medications:
            active_meds   = [m for m in medications if m.get('status') == 'Active']
            inactive_meds = [m for m in medications if m.get('status') != 'Active']
            if active_meds:
                st.markdown("#### Active Medications")
                for idx, med in enumerate(active_meds):
                    c1, c2, c3 = st.columns([4, 1, 1])
                    with c1:
                        st.write(f"**{med['medication']}** — {med['dosage']} ({med['frequency']})")
                    with c2:
                        if st.button("Discontinue", key=f"doc_disc_{patient_id}_{idx}"):
                            st.session_state[f"doc_show_disc_{patient_id}_{idx}"] = True
                    with c3:
                        st.markdown('<div class="delete-btn">', unsafe_allow_html=True)
                        if st.button("×", key=f"doc_del_med_{patient_id}_{idx}"):
                            all_meds = st.session_state.patients[patient_id]['medications']
                            active_only = [m for m in all_meds if m.get('status') == 'Active']
                            med_to_del = active_only[idx]
                            st.session_state.patients[patient_id]['medications'] = [
                                m for m in all_meds if m is not med_to_del]
                            sync_medication_to_trip_visit(patient_id)
                            auto_save_doctor_visit(patient_id)
                            save_patient_record(patient_id)
                            st.rerun()
                        st.markdown('</div>', unsafe_allow_html=True)
                    if st.session_state.get(f"doc_show_disc_{patient_id}_{idx}"):
                        with st.form(f"doc_disc_form_{patient_id}_{idx}"):
                            reason = st.text_input("Reason for discontinuation")
                            end_date = st.date_input("End Date", value=date.today())
                            if st.form_submit_button("Confirm Discontinue"):
                                for m in st.session_state.patients[patient_id]['medications']:
                                    if (m['medication'] == med['medication'] and
                                            m['start_date'] == med['start_date']):
                                        m['status'] = 'Discontinued'
                                        m['end_date'] = str(end_date)
                                        m['discontinue_reason'] = reason
                                        break
                                sync_medication_to_trip_visit(patient_id)
                                auto_save_doctor_visit(patient_id)
                                save_patient_record(patient_id)
                                st.session_state[f"doc_show_disc_{patient_id}_{idx}"] = False
                                st.success("Medication discontinued.")
                                st.rerun()
                    st.markdown("---")
            if inactive_meds:
                st.markdown("#### Discontinued Medications")
                for med in inactive_meds:
                    with st.expander(f"[Discontinued] {med['medication']} — {med['dosage']}"):
                        st.write(f"**Frequency:** {med.get('frequency','N/A')}")
                        st.write(f"**End Date:** {med.get('end_date','N/A')}")
                        st.write(f"**Reason:** {med.get('discontinue_reason','N/A')}")


def render_doctor_patient_list():
    doctor_type = st.session_state.get('doctor_type', '')
    st.markdown(f'<div class="main-header">My Patients — {doctor_type}</div>', unsafe_allow_html=True)

    selected_id = st.session_state.get('doctor_selected_patient_id')
    if selected_id and selected_id in st.session_state.patients:
        if st.button("← Back to Patient List"):
            st.session_state.doctor_selected_patient_id = None
            st.rerun()
        st.markdown("---")
        render_doctor_patient_detail(selected_id)
        return

    assigned = {pid: p for pid, p in st.session_state.patients.items()
                if p.get('assigned_doctor_type') == doctor_type}

    if not assigned:
        st.info(f"No patients assigned to {doctor_type} for this trip.")
        return

    st.markdown(f"**{len(assigned)} patient(s) assigned to you this trip**")
    st.markdown("---")
    for pid, patient in assigned.items():
        c1, c2, c3, c4 = st.columns([2, 2, 3, 1])
        with c1:
            st.write(f"**{patient['first_name']} {patient['last_name']}**")
            st.write(f"ID: {pid}")
        with c2:
            dob_str = patient.get('date_of_birth', '')
            if dob_str:
                dob_d = parse_dob(dob_str)
                age_str = f" (Age: {calculate_age(dob_d)})" if dob_d else ""
                st.write(f"DOB: {format_dob(dob_str)}{age_str}")
        with c3:
            has_diagnosis = bool(patient.get('diagnosis', {}).get('diagnosis'))
            status_parts = []
            if has_diagnosis:
                status_parts.append("Diagnosis recorded")
            active_meds = [m for m in patient.get('medications', []) if m.get('status') == 'Active']
            if active_meds:
                status_parts.append(f"{len(active_meds)} medication(s)")
            st.write(" | ".join(status_parts) if status_parts else "Awaiting doctor entry")
        with c4:
            if st.button("Open", key=f"doc_open_{pid}"):
                st.session_state.doctor_selected_patient_id = pid
                st.rerun()
        st.markdown("---")

# PATIENT FORMS (combines tabs by role)
def render_patient_forms():
    role = st.session_state.get('role', 'student')
    if role == 'student':
        tab1, tab2 = st.tabs(["Register Patient","Add Medical Entry"])
        with tab1: render_register_patient()
        with tab2: render_add_medical_entry()
    else:
        render_doctor_patient_list()

# Data management = Doctor Only
def render_data_management():
    st.markdown('<div class="main-header">Data Management</div>', unsafe_allow_html=True)
    c1, c2 = st.columns(2)

    with c1:
        st.markdown("### Backup & Save")
        st.info("All data is automatically saved to local files when you make changes.")
        if st.button("Save All Data Now", type="primary", use_container_width=True):
            save_patients_to_file()
            st.success("All data saved successfully!")

        st.markdown("---")
        st.markdown("### Export Data")
        if st.session_state.patients:
            export_format = st.selectbox("Export Format", ["CSV","JSON"], key="sb_export_format")
            if st.button("Export All Patients", use_container_width=True):
                if export_format == "JSON":
                    st.download_button("Download JSON",
                        data=json.dumps(st.session_state.patients, indent=2),
                        file_name=f"emr_export_{date.today()}.json", mime="application/json")
                else:
                    rows = []
                    for pid, p in st.session_state.patients.items():
                        dob_str = p.get('date_of_birth','')
                        dob_d = parse_dob(dob_str)
                        age = calculate_age(dob_d) if dob_d else ''
                        rows.append({
                            'Patient ID': pid,
                            'First Name': p.get('first_name',''),
                            'Last Name': p.get('last_name',''),
                            'DOB': format_dob(dob_str),
                            'Age': age,
                            'Gender': p.get('gender',''),
                            'Phone': p.get('phone',''),
                            'Address': p.get('address',''),
                            'Emergency Contact': p.get('emergency_contact',''),
                            'Water Source': p.get('water_source',''),
                            'Water Risk': p.get('water_risk_rating',''),
                            'Conditions': ', '.join([c['condition'] for c in p.get('conditions',[])]),
                            'Registration Date': p.get('registration_date','')
                        })
                    st.download_button("Download CSV",
                        data=pd.DataFrame(rows).to_csv(index=False),
                        file_name=f"emr_patients_{date.today()}.csv", mime="text/csv")

            st.markdown("---")
            st.markdown("### Export Individual Patient")
            patient_options = {f"{pid} - {p['first_name']} {p['last_name']}": pid
                               for pid, p in st.session_state.patients.items()}
            sel = st.selectbox("Select Patient to Export", list(patient_options.keys()), key="sb_export_patient")
            pid_exp = patient_options[sel]
            if st.button("Export Patient Record", use_container_width=True):
                st.download_button("Download Patient JSON",
                    data=json.dumps({pid_exp: st.session_state.patients[pid_exp]}, indent=2),
                    file_name=f"patient_{pid_exp}_{date.today()}.json", mime="application/json")

            st.markdown("---")
            st.markdown("### Export by Age Group")

            def age_from_patient(p):
                dob_str = p.get('date_of_birth','')
                dob_d = parse_dob(dob_str)
                return calculate_age(dob_d) if dob_d else None

            def export_group_csv(group_patients):
                rows = []
                for pid, p in group_patients.items():
                    dob_str = p.get('date_of_birth','')
                    rows.append({
                        'Patient ID': pid,
                        'First Name': p.get('first_name',''),
                        'Last Name': p.get('last_name',''),
                        'DOB': format_dob(dob_str),
                        'Age': age_from_patient(p),
                        'Gender': p.get('gender',''),
                        'Phone': p.get('phone',''),
                        'Water Risk': p.get('water_risk_rating',''),
                        'Registration Date': p.get('registration_date','')
                    })
                return pd.DataFrame(rows).to_csv(index=False)

            age_groups = [
                ('infants',     'Infants (0–2 years)',      0,  2),
                ('children',    'Children (3–12 years)',    3,  12),
                ('teenagers',   'Teenagers (13–19 years)',  13, 19),
                ('adults',      'Adults (20+)',             20, 999),
            ]
            for gkey, glabel, gmin, gmax in age_groups:
                group_pts = {pid: p for pid, p in st.session_state.patients.items()
                             if age_from_patient(p) is not None and gmin <= age_from_patient(p) <= gmax}
                ca, cb = st.columns([3,2])
                with ca:
                    st.write(f"**{glabel}** — {len(group_pts)} patient(s)")
                with cb:
                    if group_pts:
                        st.download_button("Export CSV",
                            data=export_group_csv(group_pts),
                            file_name=f"emr_{gkey}_{date.today()}.csv",
                            mime="text/csv", key=f"dl_{gkey}")
                    else:
                        st.write("No patients")
        else:
            st.warning("No patients to export.")

    with c2:
        st.markdown("### Import Data")
        uploaded_file = st.file_uploader("Upload JSON Backup", type=['json'])
        if uploaded_file:
            try:
                imported_data = json.load(uploaded_file)
                st.success(f"File loaded: {len(imported_data)} patient(s) found")
                import_mode = st.radio("Import Mode",
                    ["Merge (add new, keep existing)","Replace All (clear existing data)"])
                if st.button("Import Data", type="primary", use_container_width=True):
                    if import_mode == "Replace All (clear existing data)":
                        st.session_state.patients = imported_data
                    else:
                        for pid, pdata in imported_data.items():
                            if pid not in st.session_state.patients:
                                st.session_state.patients[pid] = pdata
                    save_patients_to_file()
                    st.success("Data imported successfully!")
                    st.rerun()
            except Exception as e:
                st.error(f"Error reading file: {e}")

        st.markdown("---")
        st.markdown("### Data Statistics")
        total_patients = len(st.session_state.patients)
        total_visits = sum(len(p.get('visits',[])) for p in st.session_state.patients.values())
        total_vitals = sum(len(p.get('vital_entries',[])) for p in st.session_state.patients.values())
        total_diabetic = sum(len(p.get('diabetic_entries',[])) for p in st.session_state.patients.values())
        total_meds = sum(len(p.get('medications',[])) for p in st.session_state.patients.values())
        st.metric("Total Patients", total_patients)
        st.metric("Total Visits Recorded", total_visits)
        st.metric("Total Vital Sign Entries", total_vitals)
        st.metric("Total Diabetic Entries", total_diabetic)
        st.metric("Total Medications", total_meds)

# Cross trip search
def render_cross_trip_search():
    st.markdown('<div class="main-header">Search All Trips</div>', unsafe_allow_html=True)

    search_query = st.text_input("Search patients across all trips",
        placeholder="Name, patient ID, diagnosis, phone, address...", key="cross_search_input")

    if not search_query or len(search_query) < 2:
        st.info("Enter at least 2 characters to search.")
        return

    trips = load_trips()
    if not trips:
        st.info("No trips found.")
        return

    q = search_query.lower().strip()
    results = []
    suggestions = set()

    for trip_id, trip_meta in trips.items():
        patients = load_trip_patients(trip_id)
        for pid, p in patients.items():
            full_name = f"{p.get('first_name','')} {p.get('last_name','')}".strip()
            diagnosis = p.get('diagnosis', {})
            diag_text = diagnosis.get('diagnosis','') if isinstance(diagnosis, dict) else ''
            chief = diagnosis.get('chief_complaint','') if isinstance(diagnosis, dict) else ''
            conditions = ' '.join(c.get('condition','') for c in p.get('conditions',[]))
            search_blob = ' '.join([
                full_name, pid,
                p.get('phone',''), p.get('address',''),
                p.get('gender',''), str(p.get('date_of_birth','')),
                diag_text, chief, conditions
            ]).lower()

            if q in search_blob:
                results.append({
                    'patient_id': pid,
                    'trip_id': trip_id,
                    'trip_name': trip_meta.get('name', trip_id),
                    'full_name': full_name,
                    'dob': format_dob(p.get('date_of_birth','')),
                    'gender': p.get('gender',''),
                    'phone': p.get('phone',''),
                    'diagnosis': diag_text,
                    'chief_complaint': chief,
                    'conditions': conditions,
                    'visits': p.get('visits', []),
                    'water_risk': p.get('water_risk_rating',''),
                })
                suggestions.add(full_name)
                suggestions.add(pid)

    # Autocomplete suggestions
    sugg_list = [s for s in sorted(suggestions) if q in s.lower()][:8]
    if sugg_list and len(q) < 20:
        with st.expander("Suggestions", expanded=True):
            cols = st.columns(min(len(sugg_list), 4))
            for i, s in enumerate(sugg_list):
                with cols[i % 4]:
                    if st.button(s, key=f"sugg_{i}"):
                        st.session_state['cross_search_input'] = s
                        st.rerun()

    if not results:
        st.warning("No patients found matching your search.")
        return

    st.markdown(f"**{len(results)} result(s) found**")
    st.markdown("---")

    for res in results:
        with st.expander(f"{res['full_name']} — {res['patient_id']} ({res['trip_name']})"):
            c1, c2 = st.columns(2)
            with c1:
                st.write(f"**Patient ID:** {res['patient_id']}")
                st.write(f"**Trip:** {res['trip_name']} (ID: {res['trip_id']})")
                st.write(f"**DOB:** {res['dob']}")
                st.write(f"**Gender:** {res['gender']}")
                st.write(f"**Phone:** {res['phone']}")
            with c2:
                st.write(f"**Water Risk:** {res['water_risk']}")
                if res['conditions']:
                    st.write(f"**Conditions:** {res['conditions']}")
                if res['chief_complaint']:
                    st.write(f"**Chief Complaint:** {res['chief_complaint']}")
                if res['diagnosis']:
                    st.write(f"**Diagnosis:** {res['diagnosis']}")

            visits = res['visits']
            non_trip_visits = [v for v in visits if not v.get('trip_visit')]
            trip_visits     = [v for v in visits if v.get('trip_visit')]
            if trip_visits or non_trip_visits:
                st.markdown("**Visits:**")
                for v in trip_visits:
                    st.write(f"  - Trip Visit ({v.get('date','')}) — Doctor: {v.get('doctor_type','N/A')}")
                for v in non_trip_visits:
                    st.write(f"  - {v.get('date','')} {v.get('visit_type','')} — {v.get('diagnosis','')}")

# Main
def main():
    initialize_session_state()

    # Not logged in = show login
    if not st.session_state.logged_in:
        render_login()
        return

    # Logged in but no trip selected → show trip home
    if not st.session_state.current_trip_id:
        render_trip_home()
        return

    # Inside a trip: reload data and start autorefresh 
    st_autorefresh(interval=5000, key="data_autorefresh")
    fresh_patients = load_trip_patients(st.session_state.current_trip_id)
    st.session_state.patients = fresh_patients
    st.session_state.patient_counter = len(fresh_patients)

    page = render_sidebar()

    if page == "Dashboard":
        render_dashboard()
    elif page == "Patient Forms":
        render_patient_forms()
    elif page == "Patient Records":
        render_patient_records()
    elif page == "Visit History":
        render_visit_history()
    elif page == "Data Management":
        render_data_management()
    elif page == "Search":
        render_cross_trip_search()

if __name__ == "__main__":
    main()
