/**
 * Pure Today timeline (v1). Timed meetings shown chronologically; tasks shown as
 * an UNSLOTTED work queue. It invents no task times, due times or planning slots.
 */
import type { TaskView } from "@/lib/planner/tasks/task-view";
import { remainingMeetings, type TodayMeeting } from "./today-meeting";

export interface TodayTimeline {
  meetings: TodayMeeting[]; // chronological, not-yet-ended, not cancelled
  taskQueue: TaskView[]; // unslotted actionable queue, in caller order
}

export function buildTimeline(meetings: TodayMeeting[], actionable: TaskView[], now: Date): TodayTimeline {
  return { meetings: remainingMeetings(meetings, now), taskQueue: actionable };
}
