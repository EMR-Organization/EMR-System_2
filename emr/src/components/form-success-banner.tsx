import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function FormSuccessBanner({ children }: { children: ReactNode }) {
  return (
    <Alert role="status">
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
