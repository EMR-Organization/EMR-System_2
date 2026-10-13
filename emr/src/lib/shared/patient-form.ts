// Shared by the register and edit server actions.

/** Reads the demographic fields from a submitted form, as service input. */
export function patientInputFrom(form: FormData) {
  const get = (k: string) => form.get(k) ?? undefined;
  return {
    firstName: get("firstName"),
    lastName: get("lastName"),
    dateOfBirth: get("dateOfBirth"),
    ageValue: get("ageValue"),
    ageUnit: get("ageUnit"),
    gender: get("gender"),
    assignedSpecialty: get("assignedSpecialty"),
    phone: get("phone"),
    address: get("address"),
    emergencyContact: get("emergencyContact"),
    waterSource: get("waterSource"),
    waterRiskRating: get("waterRiskRating"),
    waterHistory: form.getAll("waterHistory"),
    waterNotes: get("waterNotes"),
  };
}
