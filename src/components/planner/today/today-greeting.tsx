import type { Greeting } from "@/lib/planner/today/greeting";

/** Contextual greeting header — salutation + first name, date, one workload sentence. */
export function TodayGreeting({ greeting }: { greeting: Greeting }) {
  const hello = greeting.firstName ? `${greeting.salutation}, ${greeting.firstName}` : greeting.salutation;
  return (
    <header>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{hello}</h1>
      <p className="mt-1 text-sm text-ink-400">{greeting.dateLabel}</p>
      <p className="mt-2 text-sm text-ink-600">{greeting.workload}</p>
    </header>
  );
}
