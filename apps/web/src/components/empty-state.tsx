import { Stack, Typography } from "@mui/material";
import DirectionsCarRounded from "@mui/icons-material/DirectionsCarRounded";

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <Stack spacing={1} sx={{ alignItems: "center", py: 5 }}><DirectionsCarRounded sx={{ fontSize: 34, color: "#9aaba4" }} /><Typography sx={{ fontWeight: 700 }}>{title}</Typography><Typography variant="body2" color="text.secondary">{detail}</Typography></Stack>;
}
