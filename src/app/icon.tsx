import { ImageResponse } from "next/og";
import { brand } from "@/lib/inbox/demo";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div style={{
      display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center",
      color: "#fff", background: "#07563e", borderRadius: 8, fontSize: 20, fontWeight: 700,
    }}>{brand.name[0]}</div>,
    size,
  );
}
