# Supermemory 记忆操作指南

## 使用的服务

**Supermemory** (supermemory.ai) — AI Agent 长期/短期记忆基础设施

## 认证方式

通过环境变量 `SUPERMEMORY_API_KEY` 进行 API 密钥认证，无需交互式登录。

## 安装

```bash
pip install supermemory
```

## 初始化客户端

```python
from supermemory import Supermemory
import os

client = Supermemory(api_key=os.environ["SUPERMEMORY_API_KEY"])
TAG = "project:one-extension-to-pycharm"  # 项目标签，用于隔离不同项目
```

---

## 1. 上传记忆 (Add)

### 添加文本记忆

```python
result = client.add(
    content="记忆内容文本",
    container_tag=TAG,
    metadata={"type": "project-structure", "date": "2026-04-04"}
)
print(result)  # AddResponse(id='xxx', status='queued')
```

### 添加文件

```python
client.documents.upload_file(
    file_path="./doc/some-doc.md",
    container_tag=TAG,
    metadata={"type": "documentation"}
)
```

### 添加 URL

```python
client.documents.add(
    content="https://example.com/docs",
    container_tag=TAG,
    metadata={"type": "url-reference"}
)
```

### 批量添加

```python
client.documents.batch_add(
    documents=[
        {"content": "记忆1", "container_tag": TAG},
        {"content": "记忆2", "container_tag": TAG},
    ]
)
```

---

## 2. 搜索记忆 (Search)

### 语义搜索记忆

```python
results = client.search.memories(
    q="SSH Manager ping latency",
    container_tag=TAG,
    threshold=0.3,    # 相似度阈值 0-1
    limit=10,         # 最大返回数
    rerank=True,      # 可选：重排序提高相关性
    rewrite_query=True,  # 可选：LLM 重写查询
    search_mode="memories"  # "memories" | "hybrid" | "documents"
)

print(f"找到 {results.total} 条记忆")
for r in results.results:
    print(f"  ID: {r.id}")
    print(f"  分数: {r.similarity:.3f}")
    print(f"  内容: {r.memory}")
    print(f"  元数据: {r.metadata}")
```

### 搜索文档

```python
doc_results = client.search.documents(
    q="project structure",
    container_tags=[TAG],
    limit=5,
    include_full_docs=True,  # 包含完整文档内容
    include_summary=True,    # 包含摘要
)

for d in doc_results.results:
    print(f"  文档ID: {d.document_id}")
    print(f"  标题: {d.title}")
    print(f"  分数: {d.score}")
    for chunk in d.chunks:
        print(f"    片段: {chunk.content[:100]}...")
```

---

## 3. 读取记忆 (Retrieve)

### 获取用户画像（所有动态/静态事实）

```python
profile = client.profile(container_tag=TAG)

# 动态事实（从交互中学习的）
print(f"动态事实 ({len(profile.profile.dynamic)} 条):")
for fact in profile.profile.dynamic:
    print(f"  - {fact}")

# 静态事实（手动标记为永久的）
print(f"静态事实 ({len(profile.profile.static)} 条):")
for fact in profile.profile.static:
    print(f"  - {fact}")
```

### 带查询的用户画像（只返回相关事实）

```python
profile = client.profile(
    container_tag=TAG,
    query="SSH features",  # 只返回与 SSH 相关的事实
    threshold=0.3
)
```

### 按 ID 获取文档

```python
doc = client.documents.get(doc_id="yAgsgSWZq4WW5ARFBECw6M")
print(f"标题: {doc.title}")
print(f"内容: {doc.content}")
```

### 列出所有文档

```python
docs = client.documents.list(container_tag=TAG, limit=20)
print(f"文档数: {docs.total}")
for d in docs.results:
    print(f"  ID: {d.id}, 标题: {d.title}, 状态: {d.status}")
```

---

## 4. 更新记忆 (Update)

```python
client.memories.update_memory(
    memory_id="mem_xxx",
    content="更新后的记忆内容",
    container_tag=TAG,
    metadata={"type": "updated-feature", "date": "2026-04-04"}
)
```

---

## 5. 删除记忆 (Forget/Delete)

### 按 ID 删除记忆

```python
client.memories.forget(memory_id="mem_xxx", container_tag=TAG)
```

### 按内容删除记忆

```python
client.memories.forget(
    content="过时的功能描述",
    container_tag=TAG
)
```

### 删除文档

```python
client.documents.delete(doc_id="doc_xxx", container_tag=TAG)
```

---

## 6. 文档管理

### 查看文档处理状态

```python
status = client.documents.list_processing(container_tag=TAG)
for doc in status.results:
    print(f"  ID: {doc.id}, 状态: {doc.status}")
```

### 查看文档分块

```python
doc = client.documents.get(doc_id="doc_xxx")
for i, chunk in enumerate(doc.chunks):
    print(f"  片段 {i}: {chunk.content[:100]}...")
```

---

## 关键概念

| 概念 | 说明 |
|------|------|
| `container_tag` | 容器标签，用于隔离不同用户/项目的记忆 |
| `content` | 记忆的文本内容 |
| `metadata` | 自定义元数据（类型、日期等），可用于过滤 |
| `status: queued` | 记忆提交后进入队列，Supermemory 后台处理（提取、索引） |
| `threshold` | 相似度阈值 0-1，越高越精确 |
| `search_mode` | `"memories"`(提取的记忆) / `"hybrid"`(记忆+文档片段) / `"documents"`(完整文档) |
| `rerank` | 重排序，提高搜索结果相关性 |
| `rewrite_query` | LLM 重写查询，提高匹配度 |

## SDK 版本

当前使用 `supermemory==3.32.0`，API 可能随版本变化。

## 实际测试记录

### 2026-04-04 测试结果

1. **上传记忆** ✅ - `client.add()` 返回 `AddResponse(id='yAgsgSWZq4WW5ARFBECw6M', status='queued')`
2. **搜索记忆** ✅ - `client.search.memories()` 返回 5 条记忆，最高分 0.771
3. **搜索文档** ✅ - `client.search.documents()` 返回文档及分块内容
4. **用户画像** ✅ - `client.profile()` 返回 10 条动态事实，0 条静态事实
5. **带查询画像** ✅ - `client.profile(query="SSH features")` 返回相关事实
6. **记住事实** ✅ - 通过 `client.add()` 添加新记忆
7. **更新记忆** ✅ - `client.memories.update_memory()` 成功更新
8. **列出文档** ✅ - `client.documents.list()` 返回文档列表

### 注意事项

- `search.documents()` 使用 `container_tags`（复数，列表类型），不是 `container_tag`
- `search.documents()` 不支持 `threshold` 参数
- `search.memories()` 支持 `search_mode="hybrid"` 进行混合搜索
- `client.remember` 不存在，使用 `client.add()` 代替
- `client.tags` 不存在（Python SDK 3.32.0 版本）
- Profile 结果通过 `profile.profile.dynamic` 和 `profile.profile.static` 访问
