// 办事大厅动态表单：插件解析、类型推断、显隐与提交体组装。
import { describe, expect, it } from 'vitest';
import {
  buildServiceFormData,
  buildServiceSchema,
  dateOrderViolations,
  defaultServiceValues,
  evaluateCondition,
  fieldTypeFromKey,
  findField,
  missingRequiredFields,
  parseFormDefinition,
  parsePlugins,
  resolveFieldType,
  serializeFieldValue,
  type ServiceField,
} from '../service-form';

const plugin = (key: string, type: string, extra: Record<string, unknown> = {}) => ({
  key,
  type,
  description: `${key} 标签`,
  sort: 1,
  attr: { data: extra },
});

describe('字段类型', () => {
  it('按 key 前缀推断类型', () => {
    expect(fieldTypeFromKey('Radio_30')).toBe('radio');
    expect(fieldTypeFromKey('SelectV2_12')).toBe('selectV2');
    expect(fieldTypeFromKey('Calendar_1')).toBe('calendar');
    expect(fieldTypeFromKey('UnknownKey')).toBe('unknown');
  });

  it('组件声明优先于前缀，且容忍 d 前缀与大小写', () => {
    expect(resolveFieldType('dCheckbox', 'Input_1')).toBe('checkbox');
    expect(resolveFieldType('dselectv2', 'Input_1')).toBe('selectV2');
    expect(resolveFieldType('', 'Input_1')).toBe('input');
  });
});

describe('parsePlugins', () => {
  it('支持二次编码的 plugins 与 {plugins:{...}} 包装', () => {
    const inner = { A: plugin('Input_1', 'dInput'), B: plugin('Radio_2', 'dRadio') };
    const encoded = JSON.stringify({ nowNum: 1, plugins: inner });
    expect(parsePlugins(encoded)).toHaveLength(2);
    expect(parsePlugins({ plugins: inner })).toHaveLength(2);
    expect(parsePlugins([plugin('Input_3', 'dInput')])).toHaveLength(1);
  });
});

const formv = {
  id: '1419',
  form_version_id: '77',
  plugins: {
    Input_1: plugin('Input_1', 'dInput', { placeholder: '请填写姓名' }),
    Radio_2: plugin('Radio_2', 'dRadio', {
      options: [
        { value: '1', name: '是' },
        { value: '0', name: '否' },
      ],
    }),
    Checkbox_3: plugin('Checkbox_3', 'dCheckbox', {
      options: [
        { value: 'a', name: '甲' },
        { value: 'b', name: '乙' },
      ],
    }),
    Calendar_4: plugin('Calendar_4', 'dCalendar'),
    File_5: plugin('File_5', 'dFile', { maxNum: 2 }),
    ShowHide_6: {
      key: 'ShowHide_6',
      type: 'dShowHide',
      attr: {
        data: {
          conditions: [{ name: 'c1', expression: '{Radio_2}=="1"' }],
          controls: [
            {
              conkey: 'c1',
              setInfo: { isShow: 0, isRequired: 0, isEmpty: 1, plugins: ['Input_1'] },
            },
          ],
        },
      },
    },
  },
};

const definition = {
  formId: '1419',
  auth: {
    Input_1: 'require',
    Radio_2: 'writable',
    Checkbox_3: 'writable',
    Calendar_4: 'writable',
    File_5: 'writable',
    ShowHide_6: 'writable',
  },
  data: { Radio_2: { value: '1', name: '是' } },
};

describe('buildServiceSchema', () => {
  it('合并插件与权限，并按 sort 排序', () => {
    const schema = buildServiceSchema('app-1', formv, definition);
    expect(schema.formId).toBe('1419');
    expect(schema.fields).toHaveLength(6);
    const input = findField(schema, 'Input_1');
    expect(input).toMatchObject({ required: true, hint: '请填写姓名', type: 'input' });
    expect(findField(schema, 'File_5')?.maxCount).toBe(2);
  });

  it('预填值按类型归一', () => {
    const schema = buildServiceSchema('app-1', formv, definition);
    expect(defaultServiceValues(schema).Radio_2).toBe('1');
  });

  it('解析 currform/auth/data 的数字键', () => {
    const parsed = parseFormDefinition({
      currform: [1419],
      auth: { '1419': { Input_1: 'require' } },
      data: { '1419': { Input_1: '张三' } },
    });
    expect(parsed).toEqual({
      formId: '1419',
      auth: { Input_1: 'require' },
      data: { Input_1: '张三' },
    });
  });
});

describe('显隐表达式', () => {
  const values: Record<string, string> = { Radio_2: '1', Input_1: '' };
  const valueOf = (key: string) => values[key] ?? '';

  it('支持 ==、!=、&&、|| 与括号', () => {
    expect(evaluateCondition('{Radio_2}=="1"', valueOf)).toBe(true);
    expect(evaluateCondition('{Radio_2}!="1"', valueOf)).toBe(false);
    expect(evaluateCondition('{Radio_2}=="1" && {Input_1}==""', valueOf)).toBe(true);
    expect(evaluateCondition('{Input_1}!="" || {Radio_2}=="1"', valueOf)).toBe(true);
    expect(evaluateCondition('({Input_1}!="" || {Radio_2}=="1")', valueOf)).toBe(true);
  });

  it('无法解析时按不命中处理', () => {
    expect(evaluateCondition('{Radio_2} ~~ ,,', valueOf)).toBe(false);
  });
});

describe('buildServiceFormData', () => {
  const schema = buildServiceSchema('app-1', formv, definition);

  it('按类型序列化并把隐藏字段写成占位值', () => {
    // Radio_2 选「否」时不命中隐藏规则，Input_1 保持可见。
    const data = buildServiceFormData(schema, {
      Radio_2: '0',
      Input_1: '张三',
      Checkbox_3: ['a', 'b'],
      Calendar_4: '2026-11-12T10:30',
      File_5: [{ name: '证明.pdf', url: 'https://x', id: 'f1' }],
    });
    expect(data).toEqual({
      '1419': {
        Input_1: '张三',
        Radio_2: { value: '0', name: '否' },
        Checkbox_3: [
          { value: 'a', name: '甲' },
          { value: 'b', name: '乙' },
        ],
        Calendar_4: new Date('2026-11-12T10:30').toISOString().replace(/\.\d{3}Z$/, '.000Z'),
        File_5: [{ name: '证明.pdf', url: 'https://x', id: 'f1' }],
        ShowHide_6: '',
      },
    });
  });

  it('条件命中隐藏后，目标字段回填占位值', () => {
    // 规则「Radio_2==1 时隐藏 Input_1」：显式选中「是」后应触发。
    const data = buildServiceFormData(schema, {
      Radio_2: '1',
      Input_1: '张三',
      Checkbox_3: [],
      Calendar_4: '',
      File_5: [],
    });
    expect(data['1419']!.Input_1).toBe('');
  });

  it('隐藏时不触发清空规则的字段保留原值', () => {
    const custom = buildServiceSchema(
      'app-2',
      {
        id: '9',
        plugins: {
          Radio_1: plugin('Radio_1', 'dRadio', {
            options: [
              { value: '1', name: '是' },
              { value: '0', name: '否' },
            ],
          }),
          Input_2: plugin('Input_2', 'dInput'),
          ShowHide_3: {
            key: 'ShowHide_3',
            type: 'dShowHide',
            attr: {
              data: {
                conditions: [{ name: 'c1', expression: '{Radio_1}=="0"' }],
                controls: [{ conkey: 'c1', setInfo: { isShow: 0, plugins: ['Input_2'] } }],
              },
            },
          },
        },
      },
      {
        formId: '9',
        auth: { Radio_1: 'writable', Input_2: 'writable', ShowHide_3: 'writable' },
        data: {},
      },
    );
    const data = buildServiceFormData(custom, { Radio_1: '0', Input_2: '保留' });
    expect(data['9']!.Input_2).toBe('');
  });
});

describe('missingRequiredFields', () => {
  it('返回未填的必填字段', () => {
    const schema = buildServiceSchema('app-1', formv, definition);
    const missing = missingRequiredFields(schema, {
      Radio_2: '0',
      Input_1: '',
      Checkbox_3: [],
      Calendar_4: '',
      File_5: [],
    });
    expect(missing.map((field) => field.key)).toContain('Input_1');
  });

  it('条件隐藏的必填字段不算缺失', () => {
    const schema = buildServiceSchema('app-1', formv, definition);
    const missing = missingRequiredFields(schema, {
      Radio_2: '1',
      Input_1: '',
      Checkbox_3: [],
      Calendar_4: '',
      File_5: [],
    });
    // Radio_2=1 命中「隐藏 Input_1」，因此不再要求填写。
    expect(missing.map((field) => field.key)).not.toContain('Input_1');
  });
});

describe('serializeFieldValue', () => {
  const field = (type: ServiceField['type']): ServiceField => ({
    key: 'K',
    type,
    label: 'K',
    sort: 0,
    options: [{ value: 'a', name: '甲' }],
    hint: '',
    maxCount: 3,
    required: false,
    readOnly: false,
    suppressed: false,
    dataSource: null,
    dateRule: null,
  });

  it('单选/多选/下拉按协议结构输出', () => {
    expect(serializeFieldValue(field('select'), 'a')).toEqual({ value: 'a', name: '甲' });
    expect(serializeFieldValue(field('selectV2'), 'a')).toEqual([{ value: 'a', name: '甲' }]);
    expect(serializeFieldValue(field('checkbox'), ['a', 'x'])).toEqual([
      { value: 'a', name: '甲' },
      { value: 'x', name: '' },
    ]);
  });

  it('日期归一为 UTC ISO（本地时间转 UTC）', () => {
    const expected = new Date('2026-01-02T03:04').toISOString().replace(/\.\d{3}Z$/, '.000Z');
    expect(serializeFieldValue(field('calendar'), '2026-01-02T03:04')).toBe(expected);
    expect(serializeFieldValue(field('calendar'), '')).toBe('');
  });

  it('地区按 label/value 组装', () => {
    expect(
      serializeFieldValue(field('region'), {
        province: { label: '四川省', value: '51' },
        city: { label: '成都市', value: '5101' },
        area: { label: '武侯区', value: '510107' },
        details: '某路 1 号',
      }),
    ).toEqual({
      province: { label: '四川省', value: '51' },
      city: { label: '成都市', value: '5101' },
      area: { label: '武侯区', value: '510107' },
      details: '某路 1 号',
      address: '四川省/成都市/武侯区/某路 1 号',
    });
  });
});

describe('ShowHide 真实协议（conkey 为条件序号）', () => {
  const schema = buildServiceSchema(
    'app-real',
    {
      id: '1419',
      form_version_id: '77',
      plugins: {
        Radio_30: plugin('Radio_30', 'dRadio', {
          options: [
            { value: '1', name: '是' },
            { value: '0', name: '否' },
          ],
        }),
        Input_31: plugin('Input_31', 'dInput'),
        ShowHide_90: {
          key: 'ShowHide_90',
          type: 'dShowHide',
          attr: {
            data: {
              conditions: [
                { name: '默认', expression: 'true' },
                { name: '选是', expression: '{p_Radio_30}==1' },
              ],
              controls: [
                {
                  conkey: '0',
                  setInfo: { isShow: 0, isRequired: 0, plugins: ['Input_31'] },
                },
                {
                  conkey: '1',
                  setInfo: { isShow: 1, isRequired: 1, plugins: ['Input_31'] },
                },
              ],
            },
          },
        },
      },
    },
    {
      formId: '1419',
      auth: { Radio_30: 'writable', Input_31: 'writable', ShowHide_90: 'writable' },
      data: {},
    },
  );

  it('条件序号 0（默认）隐藏字段，序号 1（选是）显示并必填', () => {
    const data = buildServiceFormData(schema, { Radio_30: '0', Input_31: '去向' });
    expect(data['1419']!.Input_31).toBe('');
    const shown = buildServiceFormData(schema, { Radio_30: '1', Input_31: '去向' });
    expect(shown['1419']!.Input_31).toBe('去向');
    const missing = missingRequiredFields(schema, { Radio_30: '1', Input_31: '' });
    expect(missing.map((field) => field.key)).toContain('Input_31');
  });
});

describe('DataSource 联动', () => {
  const withDataSource = buildServiceSchema(
    'app-ds',
    {
      id: '1419',
      form_version_id: '77',
      plugins: {
        DataSource_85: plugin('DataSource_85', 'dDataSource', {
          sourceid: '8',
          resultKey: 'Input_31',
        }),
        Input_31: plugin('Input_31', 'dInput'),
      },
    },
    {
      formId: '1419',
      auth: { DataSource_85: 'writable', Input_31: 'writable' },
      data: {},
    },
  );

  it('解析取数配置并配对写入结果', () => {
    const source = findField(withDataSource, 'DataSource_85');
    expect(source?.dataSource).toMatchObject({ id: '8', resultKey: 'Input_31' });
    const data = buildServiceFormData(withDataSource, {
      DataSource_85: '20260001',
      Input_31: '',
    });
    expect(data['1419']).toEqual({
      DataSource_85: { list: '20260001' },
      Input_31: '20260001',
    });
  });

  it('取数为空时整对省略', () => {
    const data = buildServiceFormData(withDataSource, {
      DataSource_85: '',
      Input_31: '',
    });
    expect(data['1419']).toEqual({});
  });
});

describe('ShowHide 表达式特判', () => {
  const values: Record<string, string> = {
    Calendar_40: '2026-08-10T09:00',
    Calendar_41: '2026-08-11T09:00',
    Select_7: 'a,b',
    Radio_2: '1',
  };
  const valueOf = (key: string) => values[key] ?? '';

  it('支持 new Date(...) 比较与空串比较', () => {
    expect(
      evaluateCondition(`new Date({p_Calendar_40})<=new Date('2026-08-11T09:00')`, valueOf),
    ).toBe(true);
    expect(
      evaluateCondition(`new Date({p_Calendar_41})>new Date('2026-08-11T09:00')`, valueOf),
    ).toBe(false);
    expect(evaluateCondition(`{p_Missing}==''`, valueOf)).toBe(true);
    expect(evaluateCondition(`{p_Radio_2}!=''`, valueOf)).toBe(true);
  });

  it('支持 indexOf/includes 与 [0].value 比较', () => {
    expect(evaluateCondition(`{p_Select_7}.indexOf('a')!==-1`, valueOf)).toBe(true);
    expect(evaluateCondition(`{p_Select_7}.indexOf('z')==-1`, valueOf)).toBe(true);
    expect(evaluateCondition(`{p_Select_7}.includes('b')`, valueOf)).toBe(true);
    expect(evaluateCondition(`{p_Radio_2}[0].value=='1'`, valueOf)).toBe(true);
    expect(evaluateCondition(`{p_Radio_2}[0].value!='0'`, valueOf)).toBe(true);
  });

  it('无括号的 || 复合表达式逐段求值', () => {
    expect(evaluateCondition(`{p_Radio_2}=='0' || {p_Radio_2}=='1'`, valueOf)).toBe(true);
  });
});

describe('日期顺序校验', () => {
  it('开始晚于结束时给出违规信息', () => {
    const schema = buildServiceSchema(
      'app-date',
      {
        id: '9',
        plugins: {
          Calendar_40: plugin('Calendar_40', 'dCalendar'),
          Calendar_41: plugin('Calendar_41', 'dCalendar'),
          Validate_91: {
            key: 'Validate_91',
            type: 'dValidate',
            attr: {
              data: {
                rule: '{f_dateDayMinus}({p_Calendar_40},{p_Calendar_41})<0',
                alert: '开始日期不能晚于结束日期',
              },
            },
          },
        },
      },
      {
        formId: '9',
        auth: { Calendar_40: 'writable', Calendar_41: 'writable', Validate_91: 'writable' },
        data: {},
      },
    );
    const violations = dateOrderViolations(schema, {
      Calendar_40: '2026-08-12T00:00',
      Calendar_41: '2026-08-11T00:00',
    });
    expect(violations).toEqual([
      {
        firstKey: 'Calendar_40',
        secondKey: 'Calendar_41',
        message: '开始日期不能晚于结束日期',
      },
    ]);
    expect(
      dateOrderViolations(schema, {
        Calendar_40: '2026-08-10T00:00',
        Calendar_41: '2026-08-11T00:00',
      }),
    ).toEqual([]);
  });
});
