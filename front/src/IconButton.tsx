/** Icon-only action; the label is exposed as both tooltip and accessible name. */
export function IconButton({
  label,
  onClick,
  tone,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  tone?: 'danger';
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`btn icon ${tone ?? ''}`}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
