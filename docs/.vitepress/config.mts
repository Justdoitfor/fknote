import { defineConfig } from 'vitepress'
import fs from 'node:fs'
import path from 'node:path'

type SidebarItem = {
  text: string
  link?: string
  collapsed?: boolean
  items?: SidebarItem[]
}

const docsRoot = path.resolve(__dirname, '..')
const tutorialsRoot = path.resolve(docsRoot, 'tutorials')

function normalizeTitle(raw: string) {
  const t = raw.trim()
  if (!t) return ''
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).trim()
  }
  return t
}

function readDocTitle(filePath: string, fallback: string) {
  try {
    const src = fs.readFileSync(filePath, 'utf8')
    const fm = src.match(/^---\n([\s\S]*?)\n---\n/)
    if (fm) {
      const m = fm[1].match(/(?:^|\n)title:\s*(.+?)(?:\n|$)/)
      if (m) return normalizeTitle(m[1]) || fallback
    }
    const h1 = src.match(/(?:^|\n)#\s+(.+?)(?:\n|$)/)
    if (h1) return normalizeTitle(h1[1]) || fallback
    return fallback
  } catch {
    return fallback
  }
}

function toTextFromSlug(slug: string) {
  const s = slug.replace(/[-_]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : slug
}

function listMarkdownFiles(dir: string) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name)
  } catch {
    return []
  }
}

function listDirs(dir: string) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
  } catch {
    return []
  }
}

function buildPublishedTutorialsSidebar(exclude: Set<string>): SidebarItem[] {
  const items: SidebarItem[] = []

  const rootFiles = listMarkdownFiles(tutorialsRoot)
    .filter((name) => !exclude.has(name))
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))

  for (const file of rootFiles) {
    const slug = file.replace(/\.md$/, '')
    const title = readDocTitle(path.resolve(tutorialsRoot, file), toTextFromSlug(slug))
    items.push({ text: title, link: `/tutorials/${slug}` })
  }

  const dirs = listDirs(tutorialsRoot).sort((a, b) => a.localeCompare(b, 'zh-CN'))
  for (const dir of dirs) {
    const folder = path.resolve(tutorialsRoot, dir)
    const files = listMarkdownFiles(folder).sort((a, b) => a.localeCompare(b, 'zh-CN'))
    if (!files.length) continue

    const indexFile = files.find((f) => f === 'index.md')
    const indexTitle = indexFile
      ? readDocTitle(path.resolve(folder, indexFile), toTextFromSlug(dir))
      : toTextFromSlug(dir)

    const children: SidebarItem[] = []
    for (const f of files) {
      if (f === 'index.md') continue
      const pageSlug = f.replace(/\.md$/, '')
      const pageTitle = readDocTitle(path.resolve(folder, f), toTextFromSlug(pageSlug))
      children.push({ text: pageTitle, link: `/tutorials/${dir}/${pageSlug}` })
    }

    const parent: SidebarItem = {
      text: indexTitle,
      link: indexFile ? `/tutorials/${dir}/` : undefined
    }
    if (children.length) parent.items = children
    items.push(parent)
  }

  return items
}

export default defineConfig({
  lang: 'zh-CN',
  title: 'FKNote',
  description: '在线笔记与教程整理平台',
  base: '/fknote/',
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: '教程', link: '/tutorials/getting-started' },
      { text: '日常笔记', link: '/notes/inbox' },
      { text: '新建', link: '/new/' }
    ],
    sidebar: {
      '/new/': [
        {
          text: '新建',
          items: [{ text: '新建文档', link: '/new/' }]
        }
      ],
      '/tutorials/': [
        {
          text: '教程',
          items: [
            { text: '快速开始', link: '/tutorials/getting-started' },
            { text: '组织结构', link: '/tutorials/organize' },
            { text: '写作规范', link: '/tutorials/writing' },
            { text: '展示页', link: '/tutorials/showcase' },
            { text: '长文示例', link: '/tutorials/sample-long' }
          ]
        },
        {
          text: '在线发布',
          collapsed: true,
          items: buildPublishedTutorialsSidebar(
            new Set([
              'getting-started.md',
              'organize.md',
              'writing.md',
              'showcase.md',
              'sample-long.md'
            ])
          )
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
