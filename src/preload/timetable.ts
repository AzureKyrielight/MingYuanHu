import type { CalendarEventInput, TimetableApi } from '../shared/api';
import { invoke } from './lib';

export const timetable = {
  getState: (semester?: string) => invoke('timetable:get-state', semester),
  connect: () => invoke('timetable:connect'),
  disconnect: () => invoke('timetable:disconnect'),
  listLessons: (semester?: string) => invoke('timetable:list-lessons', semester),
  listEvents: (startAt: string, endAt: string) => invoke('timetable:list-events', startAt, endAt),
  createEvent: (input: CalendarEventInput) => invoke('timetable:create-event', input),
  deleteEvent: (id: number) => invoke('timetable:delete-event', id),
  setSemesterStart: (semester: string, value: string) =>
    invoke('timetable:set-semester-start', semester, value),
  refreshSemesterStart: (semester?: string) => invoke('timetable:refresh-semester-start', semester),
  syncNow: (semester?: string) => invoke('timetable:sync', semester),
  academicCalendar: () => invoke('timetable:academic-calendar'),
  importAcademicCalendar: (semester?: string) =>
    invoke('timetable:import-academic-calendar', semester),
  exportIcs: (semester?: string) => invoke('timetable:export-ics', semester),
} satisfies TimetableApi;
