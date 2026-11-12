export type SocialLinkKind = 'github' | 'blog' | 'zhihu' | 'website' | 'bilibili';

export interface SocialLink {
  kind: SocialLinkKind;
  url: string;
  label?: string;
}

export type SponsorChannelKind = 'wechat' | 'alipay';

export interface SponsorChannel {
  kind: SponsorChannelKind;
  qr: string;
  label?: string;
}

export interface CreditPerson {
  name: string;
  avatar?: string;
  /** 品牌赞助商没有头像，改用明暗两版 logo，与 README 赞助鸣谢同一份素材。 */
  logo?: { light: string; dark: string };
  links?: SocialLink[];
  sponsor?: {
    channels: SponsorChannel[];
    note?: string;
  };
}

export interface CreditSection {
  /** 栏目标题，全表唯一，兼作列表 key */
  title: string;
  people: CreditPerson[];
}

// 明远湖光由本仓库作者维护；上游 Dela 与 SCU-CLI 按许可证保留致谢，
// 不再展示 Dela 原作者与本仓库无关的贡献者、赞助者名单。
export const creditSections: CreditSection[] = [
  {
    title: '作者',
    people: [
      {
        name: 'LxuMzn',
        links: [
          { kind: 'github', url: 'https://github.com/AzureKyrielight' },
          { kind: 'blog', url: 'https://lyuumine.cn/' },
        ],
      },
    ],
  },
  {
    title: '开源致谢',
    people: [
      {
        name: 'Dela（上游项目）',
        links: [
          { kind: 'github', url: 'https://github.com/Chang-Yo/Dela' },
          { kind: 'website', url: 'https://dela.changyo.me' },
        ],
      },
      { name: 'SCU-CLI（校园接口参考实现）' },
    ],
  },
];
