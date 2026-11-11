import { describe, expect, it } from 'vitest';
import {
  scuBalanceAmount,
  scuBalanceFields,
  scuClassRows,
  scuClassroomBuildings,
  scuClassroomCampuses,
  scuClassroomRows,
  scuClassroomTypeList,
  scuCompletionPlans,
  scuCourseRows,
  scuFitnessSummary,
  scuGradeRows,
  scuGradeSummary,
  scuProgramCourse,
  scuProgramRows,
  scuProgramTree,
  scuScheduleItems,
  scuSubjects,
} from '../scu-present';

describe('scuGradeRows', () => {
  it('摊平及格成绩的 lnList/cjList 分组并带上学期', () => {
    const rows = scuGradeRows({
      lnList: [
        {
          cjlx: '2025-2026学年秋(两学期)',
          cjList: [
            {
              courseName: '编译原理',
              englishCourseName: 'Principle of Compiler',
              courseAttributeName: '必修',
              credit: '3',
              cj: '74.0',
              courseScore: 74,
              gradePointScore: 3,
              gradeName: 'B-',
            },
            {
              courseName: '体育四',
              courseAttributeName: '任选',
              credit: '1',
              cj: '92',
              courseScore: 92,
              gradePointScore: 4.2,
              gradeName: 'A',
            },
          ],
        },
      ],
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.name === '编译原理')).toMatchObject({
      english: 'Principle of Compiler',
      attribute: '必修',
      credit: '3',
      score: '74.0',
      point: '3',
      grade: 'B-',
      term: '2025-2026学年秋(两学期)',
    });
  });

  it('方案成绩把百分成绩放在 id 对象里也能取到', () => {
    const rows = scuGradeRows({
      lnList: [
        {
          cjlx: '计算机科学与技术培养方案',
          cjList: [
            {
              id: { courseNumber: '304475020', courseScore: 74 },
              courseName: '编译原理',
              credit: '3',
              gradePointScore: 3,
              gradeName: 'B-',
            },
          ],
        },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.score).toBe('74');
  });

  it('兼容英文键名的成绩行', () => {
    const rows = scuGradeRows({
      cjList: [
        {
          classNo: '253070108',
          courseName: '高等数学',
          credit: 4,
          gradeScore: '88',
          gradePointScore: 3.7,
          gradeName: 'A-',
        },
      ],
    });
    expect(rows[0]).toMatchObject({ name: '高等数学', score: '88', point: '3.7', grade: 'A-' });
  });

  it('结构不匹配时返回空数组', () => {
    expect(scuGradeRows({ message: 'no data' })).toEqual([]);
    expect(scuGradeRows(null)).toEqual([]);
  });
});

describe('scuGradeSummary', () => {
  it('按学分加权计算均分与绩点', () => {
    const rows = scuGradeRows({
      lnList: [
        {
          cjList: [
            { courseName: 'A', credit: '3', courseScore: 90, gradePointScore: 4 },
            { courseName: 'B', credit: '1', courseScore: 70, gradePointScore: 2 },
            { courseName: 'C', credit: '0', courseScore: 100, gradePointScore: 5 },
          ],
        },
      ],
    });
    expect(scuGradeSummary(rows)).toEqual({
      courses: 3,
      credits: 4,
      average: 85,
      gpa: 3.5,
    });
  });
});

describe('scuFitnessSummary', () => {
  it('拆分总成绩与分项，并翻译常见项目名', () => {
    const summary = scuFitnessSummary({
      student_num: '202312345678',
      student_name: '张三',
      total_score: '',
      total_grade: '未测',
      report_type: '未测',
      report_desc: '暂无',
      report_status: '未参与测试',
      bmi_score: '',
      bmi_grade: '缺项',
      vc_score: 3200,
      vc_grade: '良好',
      jump_score: '',
      jump_grade: '缺项',
    });
    expect(summary?.student).toBe('张三 · 202312345678');
    expect(summary?.grade).toBe('未测');
    expect(summary?.items).toEqual([
      { label: '体重指数', score: '', grade: '缺项' },
      { label: '肺活量', score: '3200', grade: '良好' },
      { label: '立定跳远', score: '', grade: '缺项' },
    ]);
  });

  it('非对象输入返回 null', () => {
    expect(scuFitnessSummary([])).toBeNull();
    expect(scuFitnessSummary('x')).toBeNull();
  });
});

describe('scuBalanceFields', () => {
  const value = {
    type: null,
    custNo: '202312345678',
    roomNo: '601A',
    schoolName: '江安校区',
    regName: '西园7舍',
    unitName: '7单元',
    price: '0.5464',
    balance: '74.74',
  };

  it('按中文标签输出已知字段并跳过空值', () => {
    expect(scuBalanceFields(value)).toEqual([
      { label: '校区', value: '江安校区' },
      { label: '楼栋', value: '西园7舍' },
      { label: '单元', value: '7单元' },
      { label: '房间号', value: '601A' },
      { label: '户号', value: '202312345678' },
      { label: '单价（元/度）', value: '0.5464' },
      { label: '剩余电量（度）', value: '74.74' },
    ]);
  });

  it('余额与单价格式化为两位/四位小数', () => {
    expect(scuBalanceAmount(value)).toBe('74.74');
    expect(scuBalanceAmount({ balance: '0.5464' })).toBe('0.55');
    expect(scuBalanceAmount({ balance: '' })).toBeNull();
    expect(scuBalanceAmount(null)).toBeNull();
  });
});

describe('空闲教室规范化', () => {
  it('解析校区与教学楼编号（教学楼编号嵌在 id 里）', () => {
    expect(
      scuClassroomCampuses({
        campuses: [{ campusName: '江安校区', campusNumber: '1' }],
        buildings: [
          {
            id: { campusNumber: '1', teachingBuildingNumber: '101' },
            teachingBuildingName: '一教A',
          },
        ],
      }),
    ).toEqual([{ number: '1', name: '江安校区' }]);
    expect(
      scuClassroomBuildings({
        buildings: [
          {
            id: { campusNumber: '1', teachingBuildingNumber: '101' },
            teachingBuildingName: '一教A',
          },
        ],
      }),
    ).toEqual([{ campusNumber: '1', number: '101', name: '一教A' }]);
  });

  it('解析教室类型', () => {
    expect(
      scuClassroomTypeList([{ classroomtypecode: '01', classroomtypename: '多媒体教室' }]),
    ).toEqual([{ code: '01', name: '多媒体教室' }]);
  });

  it('把占用时段展开成 12 节状态矩阵', () => {
    const rows = scuClassroomRows({
      classrooms: [
        {
          classroomName: 'A101',
          id: { classroomNumber: 'A101' },
          placeNum: '60',
          classroomTypeCode: '01',
          remark: '靠近楼梯',
        },
        { classroomName: 'A102', id: { classroomNumber: 'A102' }, placeNum: 30 },
      ],
      classroomTime: [
        {
          id: { classroomNumber: 'A101', sessionstart: 1, xq: 1 },
          continuingsession: 2,
          occupancymoduleId: '06',
        },
        {
          id: { classroomNumber: 'A101', sessionstart: 5, xq: 1 },
          continuingsession: 1,
          occupancymoduleId: '07',
        },
      ],
      date: '2026-11-12',
      jxzc: 10,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'A101', seats: 60, type: '01', remark: '靠近楼梯' });
    expect(rows[0]!.statuses.slice(0, 5)).toEqual(['class', 'class', 'free', 'free', 'exam']);
    expect(rows[1]!.statuses.every((status) => status === 'free')).toBe(true);
  });

  it('未知占用码与越界节次不会污染矩阵', () => {
    const rows = scuClassroomRows({
      classrooms: [{ classroomName: 'B201', id: { classroomNumber: 'B201' } }],
      classroomTime: [
        {
          id: { classroomNumber: 'B201', sessionstart: 12 },
          continuingsession: 4,
          occupancymoduleId: 'room',
        },
        {
          id: { classroomNumber: 'B201', sessionstart: 0 },
          continuingsession: 1,
          occupancymoduleId: '99',
        },
      ],
    });
    expect(rows[0]!.statuses[11]).toBe('borrowed');
    expect(rows[0]!.statuses[0]).toBe('free');
  });

  it('结构不匹配时返回空数组', () => {
    expect(scuClassroomRows(null)).toEqual([]);
    expect(scuClassroomCampuses({})).toEqual([]);
  });
});

describe('培养方案规范化', () => {
  it('搜索结果按大写字段取值', () => {
    expect(
      scuProgramRows([
        {
          FAJHH: '10692',
          FAMC: '计算机科学与技术培养方案',
          JHMC: '2026级计算机',
          XSH: '计算机学院',
          NJ: '2026',
          XWDM: '工学学士',
        },
      ]),
    ).toEqual([
      {
        id: '10692',
        name: '计算机科学与技术培养方案',
        college: '计算机学院',
        grade: '2026',
        degree: '工学学士',
        level: '',
      },
    ]);
  });

  it('树按 parentId 计算缩进并去掉 HTML', () => {
    const tree = scuProgramTree({
      treeList: [
        { id: 'a', pId: '-1', name: '<b>通识课</b>', urlPath: '' },
        { id: 'b', pId: 'a', name: '数学', urlPath: '' },
        { id: 'c', pId: 'b', name: '高等数学', urlPath: '/student/x/1' },
      ],
    });
    expect(tree.map((node) => [node.name, node.depth, node.hasChildren])).toEqual([
      ['通识课', 0, true],
      ['数学', 1, true],
      ['高等数学', 2, false],
    ]);
    expect(tree[2]!.path).toBe('/student/x/1');
  });

  it('课程详情只保留已知中文字段', () => {
    const info = scuProgramCourse({
      flag: '1',
      kc: { kch: '304475020', kcm: '编译原理', xf: '3', xs: '48', unknown: 'x' },
    });
    expect(info?.title).toBe('编译原理');
    expect(info?.fields).toEqual([
      { label: '课程号', value: '304475020' },
      { label: '课程名称', value: '编译原理' },
      { label: '学分', value: '3' },
      { label: '学时', value: '48' },
    ]);
    expect(scuProgramCourse({ flag: '1' })).toBeNull();
  });
});

describe('学分完成规范化', () => {
  it('按方案汇总根节点学分并解析课程名', () => {
    const plans = scuCompletionPlans([
      {
        id: 'p1',
        name: '计算机科学与技术培养方案',
        nodes: [
          {
            id: 'root',
            pId: '-1',
            flagType: '001',
            name: '公共课',
            sfwc: '是',
            yxxf: '6',
            zsxf: '8',
          },
          {
            id: 'cat',
            pId: 'root',
            flagType: '001',
            name: '数学类',
            sfwc: '否',
            yxxf: '2',
            zsxf: '4',
          },
          {
            id: 'c1',
            pId: 'cat',
            flagType: 'kch',
            name: '[304112010]【全英文】新生研讨课[1学分，2023-2024学年秋](必修,96.0(20240107))',
            sfwc: '是',
            yxxf: '1',
            zsxf: '1',
          },
        ],
      },
    ]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ earned: 6, required: 8 });
    const course = plans[0]!.rows.find((row) => row.isCourse)!;
    expect(course).toMatchObject({
      name: '【全英文】新生研讨课',
      depth: 2,
      completed: true,
      courseCode: '304112010',
      credits: '1',
      term: '2023-2024学年秋',
      grade: '96.0',
    });
  });

  it('结构不匹配时返回空数组', () => {
    expect(scuCompletionPlans(null)).toEqual([]);
    expect(scuCompletionPlans([{ nodes: 'x' }])[0]!.rows).toEqual([]);
  });
});

describe('班级/课程课表规范化', () => {
  it('班级列表从 id 里取 planCode/classCode', () => {
    expect(
      scuClassRows({
        records: [
          {
            id: { executiveEducationPlanNumber: '2026-2027-1-1', classNum: '242010801' },
            className: '计科2201',
            executiveEducationPlanName: '2026-2027学年秋',
            departmentName: '计算机学院',
            subjectName: '计算机科学与技术',
          },
        ],
        total: 1,
      }),
    ).toEqual([
      {
        planCode: '2026-2027-1-1',
        classCode: '242010801',
        name: '计科2201',
        planName: '2026-2027学年秋',
        department: '计算机学院',
        subject: '计算机科学与技术',
      },
    ]);
  });

  it('课程列表按大写字段取值', () => {
    expect(
      scuCourseRows({
        records: [
          {
            ZXJXJHH: '2026-2027-1-1',
            ZXJXJHM: '2026-2027学年秋',
            KCH: '304475020',
            KCM: '编译原理',
            KXH: '01',
            XF: '3',
            KCLBMC: '专业必修',
            KSLXMC: '考试',
            KKXSM: '计算机学院',
            JSM: '张老师',
          },
        ],
      }),
    ).toEqual([
      {
        planCode: '2026-2027-1-1',
        planName: '2026-2027学年秋',
        courseCode: '304475020',
        courseSeq: '01',
        name: '编译原理',
        credits: '3',
        category: '专业必修',
        examType: '考试',
        department: '计算机学院',
        teachers: '张老师',
      },
    ]);
  });

  it('课表项展开为节次区间并按星期/节次排序', () => {
    const items = scuScheduleItems([
      {
        id: { skxq: '3', skjc: '5', kch: 'C2', kxh: '01' },
        cxjc: '2',
        kcm: '数据结构',
        jsm: '李老师',
        zcsm: '1-16周',
        xqm: '江安',
        jxlm: '一教A',
        jasm: 'A201',
      },
      {
        id: { skxq: '1', skjc: '1', kch: 'C1', kxh: '01' },
        cxjc: '2',
        kcm: '高等数学',
        jsm: '王老师',
        zcsm: '1-16周',
        xqm: '江安',
        jxlm: '一教A',
        jasm: 'A101',
      },
    ]);
    expect(items.map((item) => [item.weekday, item.startPeriod, item.name])).toEqual([
      [1, 1, '高等数学'],
      [3, 5, '数据结构'],
    ]);
    expect(items[1]!.duration).toBe(2);
    expect(items[1]!.room).toBe('A201');
  });

  it('专业列表过滤空代码', () => {
    expect(
      scuSubjects([
        { subjectCode: '0701018', subjectName: '数学与智能科技' },
        { subjectCode: '', subjectName: '空' },
      ]),
    ).toEqual([{ value: '0701018', label: '数学与智能科技' }]);
  });
});
