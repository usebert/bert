type Props = {
  text: string;
  className?: string;
};

export function SectionIntro({ text, className = "" }: Props) {
  return (
    <p className={["text-sm leading-6 text-slate-600", className].join(" ")}>{text}</p>
  );
}
