---
title: 组织结构
prev: /tutorials/getting-started
next: /tutorials/writing
---

# 组织结构

把内容当作“知识树”来组织，通常会更稳：

## 推荐的分层

- `notes/`：日常记录、会议纪要、灵感草稿
- `tutorials/`：从笔记中沉淀出来的可复用教程
- `reference/`：索引、术语表、链接集合

## 路径即分类

把路径当作分类的一部分：

```text
docs/
  notes/
    2026/
      04/
        15-daily.md
  tutorials/
    engineering/
      http-basics.md
```

## 用侧边栏表达阅读路线

侧边栏不必等“完美”再写，先把最常用的入口固定下来即可。配置入口在 [config.mts](file:///workspace/docs/.vitepress/config.mts)。
