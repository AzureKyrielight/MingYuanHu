// 办事大厅动态表单：插件解析、类型推断、显隐与提交体组装。
import { describe, expect, it } from 'vitest';
import {
  buildServiceFormData,
  buildServiceSchema,
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
