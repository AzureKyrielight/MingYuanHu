import { describe, expect, it } from 'vitest';
import { currentPlanCode, parseScheduleCourses } from '../schedule';

const sample = {
  xkxx: [
    {
      '2025-2026-2-1-01': {
        courseName: '高等数学',
        id: { coureSequenceNumber: '01' },
        attendClassTeacher: '张三',
        timeAndPlaceList: [
          {
            classDay: 1,
            classSessions: 1,
            continuingSession: 2,
            teachingBuildingName: '江安一教A',
            classroomName: '101',
            classWeek: '1111000000000000',
          },
          {
            classDay: 3,
            classSessions: 3,
            continuingSession: 2,
            teachingBuildingName: '望江基础楼',
            classroomName: 'B201',
            classWeek: '1010101010101010',
          },
        ],
      },
    },
  ],
};

describe('parseScheduleCourses', () => {
  it('maps SCU class slots to timetable rows', () => {
    const parsed = parseScheduleCourses(sample);
    expect(parsed.courseCount).toBe(1);
    expect(parsed.lessons).toHaveLength(2);
    expect(parsed.lessons[0]).toMatchObject({
      courseName: '高等数学',
      className: '01',
      teacher: '张三',
      campus: '江安',
      classroom: '江安一教A101',
      weekday: 1,
      startPeriod: 1,
      endPeriod: 2,
      periodsText: '1-2节',
      weeksText: '1-4周',
    });
    expect(JSON.parse(parsed.lessons[0]!.weekNumbers)).toEqual([1, 2, 3, 4]);
  });

  it('collapses alternating weeks and detects campus from the classroom', () => {
    const parsed = parseScheduleCourses(sample);
    expect(parsed.lessons[1]).toMatchObject({
      campus: '望江',
      weekday: 3,
      startPeriod: 3,
      endPeriod: 4,
      weeksText: '1-15周（单周）',
    });
    expect(JSON.parse(parsed.lessons[1]!.weekNumbers)).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
  });

  it('ignores unknown payload shapes', () => {
    expect(parseScheduleCourses({}).lessons).toEqual([]);
    expect(parseScheduleCourses(null).lessons).toEqual([]);
  });

  it('keeps odd/even markers in textual week ranges', () => {
    const parsed = parseScheduleCourses({
      xkxx: [
        {
          key: {
            courseName: '大学物理',
            timeAndPlaceList: [
              {
                classDay: 2,
                classSessions: 5,
                continuingSession: 2,
                classWeek: '1-8周(双)',
              },
            ],
          },
        },
      ],
    });
    expect(parsed.lessons[0]).toMatchObject({ weeksText: '2-8周（双周）' });
    expect(JSON.parse(parsed.lessons[0]!.weekNumbers)).toEqual([2, 4, 6, 8]);
  });
});

describe('currentPlanCode', () => {
  it('uses the SCU autumn/spring plan code', () => {
    expect(currentPlanCode(new Date(2026, 9, 1))).toBe('2026-2027-1-1');
    expect(currentPlanCode(new Date(2026, 0, 15))).toBe('2025-2026-1-1');
    expect(currentPlanCode(new Date(2026, 2, 1))).toBe('2025-2026-2-1');
  });
});
