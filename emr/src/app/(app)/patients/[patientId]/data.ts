import "server-only";
import { cache } from "react";
import { getPatient } from "@/server/services/patients";
import { myPermissions } from "@/server/services/users";

// One request renders the record's layout (header) and a tab page. React's
// cache() makes them share one getPatient call, so opening a record writes
// one "patient.view" audit entry, not two.
export const loadPatient = cache((patientId: string) => getPatient(patientId));
export const loadPermissions = cache((tripId: string) => myPermissions({ tripId }));
