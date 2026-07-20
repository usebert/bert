type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function DocumentSearch({ value, onChange, placeholder = "Search documents…" }: Props) {
  return (
    <input
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
      aria-label="Search documents"
    />
  );
}
