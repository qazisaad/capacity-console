import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const cx = (...parts: Array<string | false | undefined | null>) => parts.filter(Boolean).join(" ");

export function Button({ variant = "primary", className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  const styles = {
    primary: "bg-stone-900 text-white hover:bg-stone-700 disabled:bg-stone-400",
    secondary: "border border-stone-300 bg-white text-stone-900 hover:bg-stone-100 disabled:text-stone-400",
    danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300",
    ghost: "text-stone-700 hover:bg-stone-100",
  }[variant];
  return <button className={cx("rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed", styles, className)} {...props} />;
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-stone-500 focus:outline-none", className)} {...props} />;
}
export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-stone-500 focus:outline-none", className)} {...props} />;
}
export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block text-sm"><span className="mb-1 block font-medium text-stone-800">{label}</span>{children}{hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}</label>;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-stone-200 bg-white shadow-sm", className)}>
      {(title || actions) && <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3"><h2 className="text-sm font-semibold text-stone-800">{title}</h2>{actions}</header>}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad" | "info"; children: ReactNode }) {
  const styles = { neutral: "bg-stone-100 text-stone-700", good: "bg-emerald-100 text-emerald-800", warn: "bg-amber-100 text-amber-800", bad: "bg-red-100 text-red-800", info: "bg-sky-100 text-sky-800" }[tone];
  return <span className={cx("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide", styles)}>{children}</span>;
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const styles = { info: "border-sky-200 bg-sky-50 text-sky-900", error: "border-red-200 bg-red-50 text-red-900", success: "border-emerald-200 bg-emerald-50 text-emerald-900" }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-md border px-3 py-2 text-sm", styles)}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1>{description && <p className="mt-1 max-w-2xl text-sm text-stone-600">{description}</p>}</div>{actions}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <div className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm"><div className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div>{hint && <div className="mt-1 text-xs text-stone-500">{hint}</div>}</div>;
}

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">{head.map(column => <th key={column} className="px-2 py-2 font-medium">{column}</th>)}</tr></thead>
        <tbody className="divide-y divide-stone-100">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children: ReactNode; className?: string }) => <td className={cx("px-2 py-2 align-top", className)}>{children}</td>;

export function Empty({ children }: { children: ReactNode }) { return <p className="rounded-md border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">{children}</p>; }
export const fmtTime = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : "—";
export function relativeReset(value: string | undefined): string {
  if (!value) return "Reset time unavailable";
  const remaining = Date.parse(value) - Date.now();
  if (remaining <= 0) return "Reset passed · refresh required";
  const minutes = Math.ceil(remaining / 60_000);
  if (minutes < 60) return `Resets in ${minutes}m`;
  if (minutes < 1440) return `Resets in ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `Resets in ${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}
