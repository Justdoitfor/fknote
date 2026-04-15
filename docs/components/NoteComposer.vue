<script setup lang="ts">
import MarkdownIt from 'markdown-it'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

type Doc = {
  id: string
  title: string
  tags: string[]
  updatedAt: number
  content: string
}

const STORAGE_KEY = 'fknote_docs_v1'
const GIST_TOKEN_KEY = 'fknote_gist_token_v1'
const GIST_ID_KEY = 'fknote_gist_id_v1'
const GIST_FILE_NAME = 'fknote.json'
const REPO_OWNER_KEY = 'fknote_repo_owner_v1'
const REPO_NAME_KEY = 'fknote_repo_name_v1'
const REPO_BRANCH_KEY = 'fknote_repo_branch_v1'

function now() {
  return Date.now()
}

function uid() {
  const r = Math.random().toString(16).slice(2)
  return `${now().toString(16)}-${r}`
}

function loadDocs(): Doc[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Doc[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((d) => d && typeof d.id === 'string')
      .map((d) => ({
        id: d.id,
        title: typeof d.title === 'string' && d.title.trim() ? d.title : '未命名',
        tags: Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === 'string') : [],
        updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : now(),
        content: typeof d.content === 'string' ? d.content : ''
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  } catch {
    return []
  }
}

function saveDocs(docs: Doc[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs))
}

function loadString(key: string) {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function saveString(key: string, value: string) {
  localStorage.setItem(key, value)
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true
})

const docs = ref<Doc[]>([])
const activeId = ref<string>('')
const title = ref('')
const tags = ref('')
const content = ref('')
const view = ref<'write' | 'preview'>('write')
const savedAt = ref<number>(0)
const saveState = ref<'idle' | 'saving' | 'saved'>('idle')

const gistToken = ref('')
const gistId = ref('')
const cloudState = ref<'idle' | 'working' | 'ok' | 'error'>('idle')
const cloudMessage = ref('')
const cloudAt = ref<number>(0)

const repoOwner = ref('')
const repoName = ref('')
const repoBranch = ref('main')
const publishType = ref<'tutorial' | 'note'>('tutorial')
const publishSlug = ref('')
const publishState = ref<'idle' | 'working' | 'ok' | 'error'>('idle')
const publishMessage = ref('')

let saveTimer: number | undefined

function formatTime(ts: number) {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  const hh = `${d.getHours()}`.padStart(2, '0')
  const mm = `${d.getMinutes()}`.padStart(2, '0')
  return `${y}-${m}-${day} ${hh}:${mm}`
}

const activeDoc = computed(() => docs.value.find((d) => d.id === activeId.value) ?? null)
const previewHtml = computed(() => md.render(content.value))

function mergeDocs(localDocs: Doc[], remoteDocs: Doc[]) {
  const map = new Map<string, Doc>()
  for (const d of localDocs) map.set(d.id, d)
  for (const d of remoteDocs) {
    const cur = map.get(d.id)
    if (!cur || d.updatedAt > cur.updatedAt) map.set(d.id, d)
  }
  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt)
}

function encodePath(p: string) {
  return p
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/')
}

function base64Utf8(input: string) {
  const bytes = encodeURIComponent(input).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  )
  return btoa(bytes)
}

function sanitizeSlug(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

function ensureFrontmatter(src: string, pageTitle: string) {
  const s = src.trimStart()
  if (s.startsWith('---\n')) return src
  const t = pageTitle.trim() || '未命名'
  return `---\ntitle: ${t.replace(/\n/g, ' ')}\n---\n\n${src}`
}

async function githubJson<T>(url: string, init: RequestInit = {}) {
  const token = gistToken.value.trim()
  if (!token) throw new Error('请先填写 GitHub Token')
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`
    }
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `请求失败 (${res.status})`)
  }
  return (await res.json()) as T
}

async function githubRequest(url: string, init: RequestInit = {}) {
  const token = gistToken.value.trim()
  if (!token) throw new Error('请先填写 GitHub Token')
  return await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`
    }
  })
}

async function ensureGist() {
  const id = gistId.value.trim()
  if (id) return id
  const created = await githubJson<{ id: string }>('https://api.github.com/gists', {
    method: 'POST',
    body: JSON.stringify({
      description: 'FKNote sync',
      public: false,
      files: {
        [GIST_FILE_NAME]: {
          content: JSON.stringify(docs.value)
        }
      }
    })
  })
  gistId.value = created.id
  saveString(GIST_ID_KEY, created.id)
  return created.id
}

async function cloudPush() {
  cloudState.value = 'working'
  cloudMessage.value = '同步中…'
  try {
    const id = await ensureGist()
    await githubJson(`https://api.github.com/gists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        files: {
          [GIST_FILE_NAME]: {
            content: JSON.stringify(docs.value)
          }
        }
      })
    })
    cloudAt.value = now()
    cloudState.value = 'ok'
    cloudMessage.value = `已同步 · ${formatTime(cloudAt.value)}`
  } catch (e) {
    cloudState.value = 'error'
    cloudMessage.value = e instanceof Error ? e.message : '同步失败'
  }
}

async function cloudPull() {
  cloudState.value = 'working'
  cloudMessage.value = '拉取中…'
  try {
    const id = gistId.value.trim()
    if (!id) throw new Error('请先填写 Gist ID 或先点击“同步到云端”创建')
    const data = await githubJson<{
      files?: Record<string, { content?: string }>
    }>(`https://api.github.com/gists/${id}`)
    const raw = data.files?.[GIST_FILE_NAME]?.content
    if (!raw) throw new Error(`Gist 中未找到 ${GIST_FILE_NAME}`)
    const remote = JSON.parse(raw) as Doc[]
    if (!Array.isArray(remote)) throw new Error('云端数据格式不正确')
    const merged = mergeDocs(docs.value, remote)
    docs.value = merged
    if (!merged.find((d) => d.id === activeId.value)) activeId.value = merged[0]?.id ?? ''
    if (activeId.value) hydrateFromActive()
    saveDocs(docs.value)
    cloudAt.value = now()
    cloudState.value = 'ok'
    cloudMessage.value = `已拉取 · ${formatTime(cloudAt.value)}`
  } catch (e) {
    cloudState.value = 'error'
    cloudMessage.value = e instanceof Error ? e.message : '拉取失败'
  }
}

function cloudSaveCredentials() {
  saveString(GIST_TOKEN_KEY, gistToken.value.trim())
  saveString(GIST_ID_KEY, gistId.value.trim())
  cloudState.value = 'ok'
  cloudMessage.value = '凭证已保存到本地'
}

function cloudClearCredentials() {
  gistToken.value = ''
  gistId.value = ''
  saveString(GIST_TOKEN_KEY, '')
  saveString(GIST_ID_KEY, '')
  cloudState.value = 'idle'
  cloudMessage.value = ''
}

function repoSaveSettings() {
  saveString(REPO_OWNER_KEY, repoOwner.value.trim())
  saveString(REPO_NAME_KEY, repoName.value.trim())
  saveString(REPO_BRANCH_KEY, repoBranch.value.trim())
  publishState.value = 'ok'
  publishMessage.value = '仓库配置已保存到本地'
}

function repoPathForCurrentDoc() {
  const owner = repoOwner.value.trim()
  const repo = repoName.value.trim()
  if (!owner || !repo) return ''
  const slug = sanitizeSlug(publishSlug.value || title.value || 'note')
  if (!slug) return ''
  if (publishType.value === 'tutorial') return `docs/tutorials/${slug}/index.md`
  return `docs/notes/${slug}.md`
}

async function repoUpsertFile(filePath: string, fileContent: string) {
  const owner = repoOwner.value.trim()
  const repo = repoName.value.trim()
  const branch = repoBranch.value.trim() || 'main'
  if (!owner || !repo) throw new Error('请先填写 Owner/Repo')

  const apiPath = encodePath(filePath)
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  const getUrl = `${base}/contents/${apiPath}?ref=${encodeURIComponent(branch)}`

  const getRes = await githubRequest(getUrl, { method: 'GET' })
  const existing = getRes.status === 200 ? ((await getRes.json()) as { sha: string }) : null
  if (getRes.status !== 200 && getRes.status !== 404) {
    const t = await getRes.text().catch(() => '')
    throw new Error(t || `读取失败 (${getRes.status})`)
  }

  const putUrl = `${base}/contents/${apiPath}`
  const body: Record<string, any> = {
    message: `docs: publish ${title.value.trim() || 'note'}`,
    content: base64Utf8(fileContent),
    branch
  }
  if (existing?.sha) body.sha = existing.sha

  const putRes = await githubRequest(putUrl, {
    method: 'PUT',
    body: JSON.stringify(body)
  })

  if (!putRes.ok) {
    const t = await putRes.text().catch(() => '')
    throw new Error(t || `发布失败 (${putRes.status})`)
  }
}

async function publishToRepo() {
  publishState.value = 'working'
  publishMessage.value = '发布中…'
  try {
    const filePath = repoPathForCurrentDoc()
    if (!filePath) throw new Error('请先填写仓库信息与 slug')
    const pageTitle = title.value.trim() || '未命名'
    const fileContent = ensureFrontmatter(content.value, pageTitle)
    await repoUpsertFile(filePath, fileContent)
    publishState.value = 'ok'
    publishMessage.value = `已发布：${filePath}`
  } catch (e) {
    publishState.value = 'error'
    publishMessage.value = e instanceof Error ? e.message : '发布失败'
  }
}

function commitToList(next: Partial<Doc>) {
  const idx = docs.value.findIndex((d) => d.id === activeId.value)
  if (idx === -1) return
  const updated: Doc = { ...docs.value[idx], ...next, updatedAt: now() }
  docs.value.splice(idx, 1)
  docs.value.unshift(updated)
}

function scheduleSave() {
  saveState.value = 'saving'
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveDocs(docs.value)
    savedAt.value = now()
    saveState.value = 'saved'
  }, 450)
}

function hydrateFromActive() {
  const d = activeDoc.value
  if (!d) return
  title.value = d.title
  tags.value = d.tags.join(', ')
  content.value = d.content
  savedAt.value = d.updatedAt
  saveState.value = 'idle'
}

function createDoc(template?: 'daily' | 'tutorial') {
  const baseTitle = template === 'daily' ? formatTime(now()).slice(0, 10) : '未命名'
  const body =
    template === 'daily'
      ? `# ${formatTime(now()).slice(0, 10)}\n\n## 今日三件事\n- \n\n## 记录\n- \n\n## 学到的\n- \n\n## 明天继续\n- \n`
      : `# 主题标题\n\n一句话说明：这页解决什么问题。\n\n## 适用场景\n\n## 结论\n\n## 步骤\n\n## 示例\n\n## 常见问题\n`
  const d: Doc = {
    id: uid(),
    title: baseTitle,
    tags: template === 'tutorial' ? ['tutorial'] : [],
    updatedAt: now(),
    content: body
  }
  docs.value.unshift(d)
  activeId.value = d.id
  hydrateFromActive()
  scheduleSave()
}

function removeDoc(id: string) {
  const next = docs.value.filter((d) => d.id !== id)
  docs.value = next
  if (activeId.value === id) {
    activeId.value = next[0]?.id ?? ''
    if (activeId.value) hydrateFromActive()
    else {
      title.value = ''
      tags.value = ''
      content.value = ''
      saveState.value = 'idle'
    }
  }
  scheduleSave()
}

function setActive(id: string) {
  if (id === activeId.value) return
  activeId.value = id
  hydrateFromActive()
}

function exportMarkdown() {
  const d = activeDoc.value
  if (!d) return
  const safe = (d.title || 'note')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .slice(0, 64)
  const fileName = `${safe || 'note'}.md`
  const blob = new Blob([content.value], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function copyMarkdown() {
  try {
    await navigator.clipboard.writeText(content.value)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = content.value
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

function importMarkdown(file: File) {
  const reader = new FileReader()
  reader.onload = () => {
    const text = typeof reader.result === 'string' ? reader.result : ''
    const first = text.split('\n').find((l) => l.trim()) ?? ''
    const guess = first.startsWith('#') ? first.replace(/^#+\s*/, '').trim() : ''
    const d: Doc = {
      id: uid(),
      title: guess || file.name.replace(/\.md$/i, '') || '导入文档',
      tags: ['import'],
      updatedAt: now(),
      content: text
    }
    docs.value.unshift(d)
    activeId.value = d.id
    hydrateFromActive()
    scheduleSave()
  }
  reader.readAsText(file)
}

watch([title, tags, content], () => {
  if (!activeDoc.value) return
  commitToList({
    title: title.value.trim() || '未命名',
    tags: tags.value
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
    content: content.value
  })
  scheduleSave()
})

onMounted(() => {
  docs.value = loadDocs()
  gistToken.value = loadString(GIST_TOKEN_KEY)
  gistId.value = loadString(GIST_ID_KEY)
  repoOwner.value = loadString(REPO_OWNER_KEY) || 'Justdoitfor'
  repoName.value = loadString(REPO_NAME_KEY) || 'fknote'
  repoBranch.value = loadString(REPO_BRANCH_KEY) || 'main'
  if (!docs.value.length) createDoc('daily')
  else {
    activeId.value = docs.value[0].id
    hydrateFromActive()
  }
})

onBeforeUnmount(() => {
  if (saveTimer) window.clearTimeout(saveTimer)
})

const saveLabel = computed(() => {
  if (saveState.value === 'saving') return '保存中…'
  if (saveState.value === 'saved') return `已保存 · ${formatTime(savedAt.value)}`
  if (!savedAt.value) return '未保存'
  return `上次保存 · ${formatTime(savedAt.value)}`
})
</script>

<template>
  <div class="composer">
    <aside class="rail">
      <div class="rail-top">
        <div class="rail-title">本地文档</div>
        <div class="rail-actions">
          <button class="btn ghost" type="button" @click="createDoc('daily')">新建日记</button>
          <button class="btn" type="button" @click="createDoc('tutorial')">新建教程</button>
        </div>
        <label class="import">
          <input type="file" accept=".md,text/markdown" @change="(e) => (e.target && (e.target as HTMLInputElement).files?.[0] ? importMarkdown((e.target as HTMLInputElement).files![0]) : null)" />
          导入 Markdown
        </label>
        <div class="cloud">
          <div class="cloud-title">云端同步（GitHub Gist）</div>
          <input v-model="gistToken" class="cloud-input" type="password" placeholder="GitHub Token（gist 读写）" />
          <input v-model="gistId" class="cloud-input" placeholder="Gist ID（可留空自动创建）" />
          <div class="cloud-actions">
            <button class="btn ghost" type="button" @click="cloudSaveCredentials">保存凭证</button>
            <button class="btn ghost" type="button" :disabled="cloudState === 'working'" @click="cloudPull">从云端拉取</button>
            <button class="btn" type="button" :disabled="cloudState === 'working'" @click="cloudPush">同步到云端</button>
            <button class="btn danger" type="button" @click="cloudClearCredentials">清除</button>
          </div>
          <div v-if="cloudMessage" class="cloud-status" :class="{ err: cloudState === 'error' }">{{ cloudMessage }}</div>
        </div>
        <div class="cloud">
          <div class="cloud-title">发布到仓库（GitHub）</div>
          <input v-model="repoOwner" class="cloud-input" placeholder="Owner（例如 Justdoitfor）" />
          <input v-model="repoName" class="cloud-input" placeholder="Repo（例如 fknote）" />
          <input v-model="repoBranch" class="cloud-input" placeholder="Branch（例如 main）" />
          <select v-model="publishType" class="cloud-input">
            <option value="tutorial">教程目录（/tutorials/slug/index.md）</option>
            <option value="note">日常笔记（/notes/slug.md）</option>
          </select>
          <input v-model="publishSlug" class="cloud-input" placeholder="slug（留空用标题自动生成）" />
          <div class="cloud-actions">
            <button class="btn ghost" type="button" @click="repoSaveSettings">保存配置</button>
            <button class="btn" type="button" :disabled="publishState === 'working'" @click="publishToRepo">发布</button>
          </div>
          <div v-if="publishMessage" class="cloud-status" :class="{ err: publishState === 'error' }">{{ publishMessage }}</div>
        </div>
      </div>

      <div class="rail-list">
        <button
          v-for="d in docs"
          :key="d.id"
          class="doc"
          :class="{ active: d.id === activeId }"
          type="button"
          @click="setActive(d.id)"
        >
          <div class="doc-title">{{ d.title }}</div>
          <div class="doc-meta">
            <span>{{ formatTime(d.updatedAt) }}</span>
            <span v-if="d.tags.length">· {{ d.tags.slice(0, 2).join(', ') }}</span>
          </div>
        </button>
      </div>
    </aside>

    <section class="main" v-if="activeDoc">
      <header class="topbar">
        <div class="fields">
          <input v-model="title" class="input" placeholder="标题" />
          <input v-model="tags" class="input" placeholder="标签（逗号分隔）" />
        </div>
        <div class="tools">
          <div class="status">{{ saveLabel }}</div>
          <button class="btn ghost" type="button" @click="copyMarkdown">复制</button>
          <button class="btn ghost" type="button" @click="exportMarkdown">导出</button>
          <button class="btn danger" type="button" @click="removeDoc(activeDoc.id)">删除</button>
        </div>
      </header>

      <div class="switcher">
        <button class="seg" :class="{ on: view === 'write' }" type="button" @click="view = 'write'">写作</button>
        <button class="seg" :class="{ on: view === 'preview' }" type="button" @click="view = 'preview'">预览</button>
      </div>

      <div class="panel">
        <textarea v-if="view === 'write'" v-model="content" class="editor" placeholder="用 Markdown 写点什么…" />
        <div v-else class="preview vp-doc" v-html="previewHtml" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.composer {
  display: grid;
  grid-template-columns: 300px 1fr;
  gap: 18px;
  align-items: start;
}

@media (max-width: 960px) {
  .composer {
    grid-template-columns: 1fr;
  }
}

.rail {
  border-radius: 18px;
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
  background: rgba(255, 255, 255, 0.8);
  overflow: hidden;
}

.rail-top {
  padding: 14px 14px 12px;
  border-bottom: 1px solid rgb(224, 226, 232);
}

.rail-title {
  font-family: var(--fk-display-font);
  font-weight: 700;
  letter-spacing: -0.2px;
  margin-bottom: 10px;
}

.rail-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.import {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border-radius: 14px;
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  cursor: pointer;
  background: rgba(195, 250, 245, 0.25);
}

.import input {
  display: none;
}

.cloud {
  margin-top: 12px;
  border-radius: 16px;
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
  background: rgba(255, 255, 255, 0.7);
  padding: 10px;
}

.cloud-title {
  font-weight: 700;
  font-size: 12px;
  color: var(--vp-c-text-2);
  margin-bottom: 8px;
}

.cloud-input {
  width: 100%;
  border-radius: 14px;
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
  background: rgba(255, 255, 255, 0.85);
  padding: 9px 10px;
  font-size: 13px;
  margin-bottom: 8px;
}

.cloud-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.cloud-actions .btn {
  justify-content: center;
}

.cloud-status {
  margin-top: 8px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.cloud-status.err {
  color: #600000;
}

.rail-list {
  display: grid;
  padding: 10px;
  gap: 10px;
  max-height: 520px;
  overflow: auto;
}

.doc {
  text-align: left;
  border-radius: 14px;
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
  padding: 10px 10px 9px;
  background: rgba(253, 224, 240, 0.18);
  transition: transform 0.12s ease, background 0.12s ease;
}

.doc:hover {
  transform: translateY(-1px);
  background: rgba(91, 118, 254, 0.08);
}

.doc.active {
  background: rgba(91, 118, 254, 0.12);
}

.doc-title {
  font-weight: 700;
  letter-spacing: -0.1px;
  color: var(--vp-c-text-1);
}

.doc-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.main {
  border-radius: 18px;
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
  background: rgba(255, 255, 255, 0.86);
  overflow: hidden;
}

.topbar {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 12px;
  padding: 14px;
  border-bottom: 1px solid rgb(224, 226, 232);
}

@media (max-width: 960px) {
  .topbar {
    grid-template-columns: 1fr;
  }
}

.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

@media (max-width: 960px) {
  .fields {
    grid-template-columns: 1fr;
  }
}

.input {
  border-radius: 14px;
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
  background: rgba(255, 255, 255, 0.7);
  padding: 10px 12px;
  font-size: 14px;
}

.tools {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.status {
  font-size: 12px;
  color: var(--vp-c-text-2);
  padding: 0 4px;
}

.switcher {
  display: inline-flex;
  margin: 12px 14px 0;
  border-radius: 14px;
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
  background: rgba(195, 250, 245, 0.18);
  padding: 4px;
  gap: 4px;
}

.seg {
  border-radius: 11px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--vp-c-text-2);
}

.seg.on {
  background: rgba(255, 255, 255, 0.85);
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
  color: var(--vp-c-text-1);
  font-weight: 700;
}

.panel {
  padding: 14px;
}

.editor {
  width: 100%;
  min-height: 520px;
  resize: vertical;
  border-radius: 16px;
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
  background: rgba(255, 255, 255, 0.7);
  padding: 12px 12px 14px;
  font-size: 14px;
  line-height: 22px;
  font-family: var(--vp-font-family-mono);
}

.preview {
  border-radius: 16px;
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
  background: rgba(255, 255, 255, 0.7);
  padding: 18px 18px 22px;
}

.btn {
  border-radius: 14px;
  padding: 9px 11px;
  background: var(--vp-c-brand-1);
  color: white;
  font-weight: 700;
  font-size: 13px;
}

.btn.ghost {
  background: rgba(255, 255, 255, 0.85);
  color: var(--vp-c-text-1);
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
}

.btn.danger {
  background: rgba(255, 198, 198, 0.92);
  color: #600000;
  box-shadow: rgb(224, 226, 232) 0px 0px 0px 1px;
}
</style>
