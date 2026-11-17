import { Chip } from "@mui/material";
import type { RecordStatus } from "@mvp-transporte/shared-contracts";

export function StatusChip({ status }: { status: RecordStatus }) {
  return <Chip size="small" label={status === "ACTIVE" ? "Activo" : "Inactivo"} color={status === "ACTIVE" ? "success" : "default"} variant={status === "ACTIVE" ? "filled" : "outlined"} />;
}
