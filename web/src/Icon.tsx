import type { CSSProperties } from "react";
const paths = {
  arrow: "M5 12h14m-6-6 6 6-6 6",
  close: "m6 6 12 12M6 18 18 6",
  chat: "M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 8.7 3.9a8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z",
  clock: "M12 8v4l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  pin: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  calendar: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z",
  shield: "M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 10 3 3 5-5",
  video: "m16 8 6-3v14l-6-3M2 5h14v14H2V5Z",
  send: "m22 2-7 20-4-9-9-4L22 2ZM22 2 11 13",
  logout: "M9 5H3v14h6m5-14 7 7-7 7m-7-7h14",
  check: "m5 12 4 4L19 6",
  plus: "M12 4v16M4 12h16",
  refresh:
    "M20 7v5h-5M4 17v-5h5M5.7 7a7 7 0 0 1 11.6-2L20 8M4 16l2.7 3A7 7 0 0 0 18.3 17",
};
export function Icon({
  name,
  size = 20,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontWeight: 650,
        fontSize: small ? 19 : 24,
        letterSpacing: "-.7px",
      }}
    >
      <span
        style={{
          width: small ? 30 : 36,
          height: small ? 30 : 36,
          display: "grid",
          placeItems: "center",
          background: "#175342",
          color: "#fff",
          borderRadius: 11,
        }}
      >
        <Icon name="plus" size={small ? 20 : 24} />
      </span>
      CareWell<span style={{ color: "#6b8c73", marginLeft: -8 }}>.</span>
    </span>
  );
}
