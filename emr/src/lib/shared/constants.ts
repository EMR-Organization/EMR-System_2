// Fixed option lists, ported from the old app (app.py:398-414 and its form dropdowns).
// These are stored values, so keep them stable: the UI translates them for display.

export const PREEXISTING_CONDITIONS = [
  "None",
  "Diabetes Type 1",
  "Diabetes Type 2",
  "Hypertension",
  "Heart Disease",
  "Asthma",
  "COPD",
  "Chronic Kidney Disease",
  "Liver Disease",
  "Thyroid Disorder",
  "Anemia",
  "Arthritis",
  "Cancer",
  "HIV/AIDS",
  "Tuberculosis",
  "Hepatitis",
  "Malaria (Recurring)",
  "Cholera (History)",
  "Typhoid (History)",
  "Dysentery (History)",
  "Parasitic Infection",
  "Other",
] as const;

export const WATER_CONTAMINATION_CONDITIONS = [
  "Cholera",
  "Typhoid Fever",
  "Dysentery",
  "Hepatitis A",
  "Giardiasis",
  "Cryptosporidiosis",
  "Lead Poisoning",
  "Arsenic Poisoning",
  "Fluorosis",
  "Parasitic Worms",
] as const;

export const WATER_SOURCES = [
  "Municipal/Treated Water",
  "Well Water",
  "River/Stream",
  "Rainwater Collection",
  "Shared Community Source",
  "Unknown/Untreated",
] as const;

export const COMMON_MEDICATIONS = [
  "Metformin",
  "Insulin (various types)",
  "Lisinopril",
  "Amlodipine",
  "Atorvastatin",
  "Metoprolol",
  "Omeprazole",
  "Losartan",
  "Gabapentin",
  "Hydrochlorothiazide",
  "Aspirin",
  "Ibuprofen",
  "Acetaminophen",
  "Amoxicillin",
  "Ciprofloxacin",
  "Azithromycin",
  "Prednisone",
  "Albuterol",
  "Fluticasone",
  "Levothyroxine",
  "Other",
] as const;

export const MEDICATION_FREQUENCIES = [
  "Once daily",
  "Twice daily",
  "Three times daily",
  "Four times daily",
  "Every 8 hours",
  "Every 12 hours",
  "As needed",
  "Weekly",
  "Monthly",
] as const;

export const MEDICATION_ROUTES = ["Oral", "Injection", "Topical", "Inhaled", "Sublingual", "IV", "Other"] as const;

export const GLUCOSE_TIMINGS = ["Fasting", "Before Meal", "After Meal (2 hrs)", "Random", "Bedtime"] as const;

export const INSULIN_TYPES = [
  "None",
  "Rapid-acting",
  "Short-acting",
  "Intermediate-acting",
  "Long-acting",
  "Mixed",
] as const;

export const VISIT_TYPES = [
  "Regular Checkup",
  "Follow-up",
  "Emergency",
  "Consultation",
  "Procedure",
  "Lab Work",
] as const;

/** Type of the automatic per-trip visit (the old app's "trip visit"). */
export const TRIP_VISIT_TYPE = "Trip Visit";

export const PHOTO_CATEGORIES = [
  "General",
  "Wound/Injury",
  "Skin Condition",
  "X-Ray",
  "Lab Results",
  "Other Documentation",
] as const;
