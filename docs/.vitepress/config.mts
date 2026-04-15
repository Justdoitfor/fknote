import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'FKNote',
  description: '在线笔记与教程整理平台',
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: '教程', link: '/tutorials/getting-started' },
      { text: '日常笔记', link: '/notes/inbox' }
    ],
    sidebar: {
      '/tutorials/': [
        {
          text: '教程',
          items: [
            { text: '快速开始', link: '/tutorials/getting-started' },
            { text: '组织结构', link: '/tutorials/organize' },
            { text: '写作规范', link: '/tutorials/writing' }
          ]
        }
      ],
      '/notes/': [
        {
          text: '日常笔记',
          items: [
            { text: '收件箱', link: '/notes/inbox' },
            { text: '本周', link: '/notes/weekly' },
            { text: '模板', link: '/notes/templates' }
          ]
        }
      ],
      '/': [
        {
          text: '开始',
          items: [
            { text: '首页', link: '/' },
            { text: '快速开始', link: '/tutorials/getting-started' }
          ]
        }
      ]
    },
    outline: { level: [2, 3] },
    search: { provider: 'local' },
    footer: {
      message: '用更清晰的结构整理你的知识',
      copyright: 'Copyright © FKNote'
    }
  }
})
