export type IconName =
  | "arrow-right"
  | "branch"
  | "check"
  | "folder"
  | "grid"
  | "layers"
  | "plus"
  | "repos"
  | "spark"
  | "switch"
  | "trash"
  | "x";

const paths: Record<IconName, React.ReactNode> = {
  "arrow-right": <path d="M5 12h14m-5-5 5 5-5 5" />,
  branch: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="6" cy="19" r="2" />
      <path d="M6 7v10M8 7h4a6 6 0 0 1 6 6v-4" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  folder: (
    <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3-9 5 9 5 9-5z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  repos: (
    <>
      <circle cx="7" cy="5" r="2" />
      <circle cx="17" cy="19" r="2" />
      <path d="M7 7v7a5 5 0 0 0 5 5h3M7 12h5a5 5 0 0 0 5-5V5" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 1.25 3.75L17 8l-3.75 1.25L12 13l-1.25-3.75L7 8l3.75-1.25z" />
      <path d="m18.5 14 .75 2.25L21.5 17l-2.25.75L18.5 20l-.75-2.25L15.5 17l2.25-.75z" />
    </>
  ),
  switch: (
    <>
      <path d="M7 7h11l-3-3M17 17H6l3 3" />
      <path d="m18 7-3 3M6 17l3-3" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  x: <path d="m6 6 12 12M18 6 6 18" />,
};

export function Icon({
  name,
  size = 18,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
