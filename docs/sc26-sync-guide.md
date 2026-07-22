# 同步到 `DaSE-VibeCoding/SC26-29` 的操作记录

这个仓库目前使用一个单独的临时 worktree 来向目标仓库同步内容，同时保留目标仓库里“不要启用 GitHub Pages”的状态。

## 临时目录在哪里

当前使用的临时 worktree 在：

`/private/tmp/ecology-theory-games-sc26-pages-20260722`

这是 macOS 的系统临时目录之一。`/private/tmp` 不是项目目录，而是系统用来放临时文件、临时 worktree、缓存和一次性构建产物的地方。这个目录可以存在，但不应该当成长期源码目录使用。

如果你以后重新开一个同步流程，临时目录名可能会变，但通常还是会放在 `/private/tmp/` 下。

## 同步原则

- 只同步你本地主分支 `master` 里想发到目标仓库的文件。
- 不要把 `.github/workflows/deploy-pages.yml` 加回来。
- 目标仓库保持 `master` 直接可用，但不启用 Pages。

## 推荐命令

假设你已经有一个目标仓库专用的临时 worktree，并且它当前叫做 `/private/tmp/ecology-theory-games-sc26-pages-20260722`，同步 README 更新时可以这样做：

```bash
git -C /private/tmp/ecology-theory-games-sc26-pages-20260722 restore -s master -- README.md README.en.md docs/images/forest-workspace.png
git -C /private/tmp/ecology-theory-games-sc26-pages-20260722 add README.md README.en.md docs/images/forest-workspace.png
git -C /private/tmp/ecology-theory-games-sc26-pages-20260722 commit -m "docs: sync README updates"
git -C /private/tmp/ecology-theory-games-sc26-pages-20260722 push sc26 HEAD:master
```

## 每条命令在做什么

- `restore -s master -- ...`
  - 从你本地主分支 `master` 取文件内容，覆盖目标 worktree 里的同名文件。
- `add ...`
  - 把这些文件放进这次提交。
- `commit -m "..."`
  - 在临时分支上生成一个独立提交。
- `push sc26 HEAD:master`
  - 把当前临时分支的提交推到目标仓库 `DaSE-VibeCoding/SC26-29` 的 `master`。

## 注意事项

- 如果本地主分支还有别的改动，先确认哪些文件要同步，再决定 `restore` 的文件列表。
- 如果你只是改了 README，通常只需要同步 `README.md`、`README.en.md`，以及相关图片。
- 如果你不确定要不要带某个文件，先看 `git diff --name-status sc26/master..master`。

