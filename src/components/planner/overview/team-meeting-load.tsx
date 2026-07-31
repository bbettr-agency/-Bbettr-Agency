import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";

/** Meeting-volume only — NOT capacity/workload (no tasks exist yet). */
export interface MemberLoad {
  id: string;
  name: string;
  today: number;
  week: number;
  nextTime: string | null;
}

export function TeamMeetingLoad({ members }: { members: MemberLoad[] }) {
  if (members.length === 0) {
    return <p className="text-sm text-ink-500">No admin team members.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {members.map((m) => (
        <Card key={m.id}>
          <CardContent className="py-4">
            <div className="flex items-center gap-2.5">
              <Avatar name={m.name} size="sm" />
              <p className="truncate text-sm font-semibold text-ink-900">{m.name}</p>
            </div>
            <div className="mt-3 flex items-center gap-5 text-sm">
              <div>
                <span className="font-semibold text-ink-900">{m.today}</span>{" "}
                <span className="text-ink-500">today</span>
              </div>
              <div>
                <span className="font-semibold text-ink-900">{m.week}</span>{" "}
                <span className="text-ink-500">this week</span>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-ink-400">
              {m.nextTime ? `Next at ${m.nextTime}` : "No upcoming meetings"}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
