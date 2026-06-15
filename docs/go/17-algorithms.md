# 第 17 章：经典算法解析与实现

> 目标读者：掌握 Go 基础并希望深入理解经典算法思想的开发者。每个算法先讲"为什么"，再讲"怎么做"，最后才是代码。

---

## 17.1 TopK 问题

### 问题定义

从 N 个元素中找出最大（或最小）的 K 个元素。变体包括"第 K 大元素"、"前 K 小"、"实时数据流 TopK"等。

### 为什么不能直接排序？

排序取前 K 的时间复杂度是 O(N·logN)。当 N 很大（比如 10 亿）而 K 很小（比如 10）时，排序做了大量无用功——我们只关心前 K 个，其余 N-K 个的相对顺序完全不重要。TopK 问题的核心就是**避免对不需要排序的部分排序**。

### 17.1.1 小顶堆解法

#### 原理分析

维护一个大小为 K 的**小顶堆**。小顶堆的堆顶是堆中最小的元素，也就是"当前 TopK 的守门员"：

- 遍历每个元素时，如果堆未满（大小 < K），直接入堆
- 如果堆已满，比较当前元素与堆顶：
  - 当前元素 > 堆顶 → 弹出堆顶，插入新元素（新元素"踢掉"了最小的守门员）
  - 当前元素 ≤ 堆顶 → 跳过（连守门员都打不过，不可能进 TopK）

为什么用小顶堆而不是大顶堆？因为我们需要快速知道"当前 K 个候选中最小的那个"来决定是否淘汰。大顶堆的堆顶是最大值，无法帮我们做这个判断。

#### 图解过程

```
数组: [3, 1, 4, 1, 5, 9, 2, 6], K=3，求前3大

Step 1: 元素3 → 堆未满，入堆        堆 = [3]
Step 2: 元素1 → 堆未满，入堆        堆 = [1, 3]
Step 3: 元素4 → 堆未满，入堆        堆 = [1, 3, 4]  ← 堆满
Step 4: 元素1 → 1 ≤ 堆顶1? 是，跳过  堆 = [1, 3, 4]
Step 5: 元素5 → 5 > 堆顶1? 是，替换  堆 = [3, 5, 4]  ← 弹出1，插入5
Step 6: 元素9 → 9 > 堆顶3? 是，替换  堆 = [4, 5, 9]  ← 弹出3，插入9
Step 7: 元素2 → 2 > 堆顶4? 否，跳过  堆 = [4, 5, 9]
Step 8: 元素6 → 6 > 堆顶4? 是，替换  堆 = [5, 6, 9]  ← 弹出4，插入6

结果: {5, 6, 9} — 最大的3个元素
```

#### 复杂度分析

- **时间**：每个元素最多做一次堆操作（push + pop），堆大小为 K，单次操作 O(logK)，共 N 个元素 → **O(N·logK)**
- **空间**：堆最多存 K 个元素 → **O(K)**
- 当 K ≪ N 时，O(N·logK) 远优于排序的 O(N·logN)

#### Go 实现

```go
package main

import (
	"container/heap"
	"fmt"
)

// IntMinHeap 小顶堆
type IntMinHeap []int

func (h IntMinHeap) Len() int           { return len(h) }
func (h IntMinHeap) Less(i, j int) bool { return h[i] < h[j] }
func (h IntMinHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }

func (h *IntMinHeap) Push(x interface{}) {
	*h = append(*h, x.(int))
}

func (h *IntMinHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

// TopKMax 使用小顶堆找出前 K 大的元素
func TopKMax(nums []int, k int) []int {
	if k <= 0 || k > len(nums) {
		return nil
	}

	h := &IntMinHeap{}
	heap.Init(h)

	for _, num := range nums {
		if h.Len() < k {
			heap.Push(h, num)
		} else if num > (*h)[0] {
			heap.Pop(h)
			heap.Push(h, num)
		}
	}

	result := make([]int, h.Len())
	for i := h.Len() - 1; i >= 0; i-- {
		result[i] = heap.Pop(h).(int)
	}
	return result
}

func main() {
	nums := []int{3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5}
	fmt.Printf("Top %d max: %v\n", 3, TopKMax(nums, 3))
	// Top 3 max: [5 6 9]
}
```

### 17.1.2 快速选择（QuickSelect）求第 K 大

#### 原理分析

快速排序每次 partition 后，pivot 左边都 ≤ pivot，右边都 > pivot。如果我们只关心"第 K 大"这一个位置，那 partition 后：

- pivot 恰好落在目标位置 → 找到了
- pivot 在目标位置左边 → 只需递归右侧
- pivot 在目标位置右边 → 只需递归左侧

与快排的区别：快排两侧都要递归，QuickSelect 只递归一侧。这就是为什么平均复杂度从 O(N·logN) 降到 O(N)。

#### 复杂度推导

- **平均**：T(N) = T(N/2) + O(N)，由主定理得 T(N) = O(N)
- **最坏**：每次选到最差 pivot（如已排序数组选首元素），T(N) = T(N-1) + O(N) = O(N²)
- **随机化 pivot**：将最坏概率降到极低，工程上视为 O(N)

#### Go 实现

```go
package main

import (
	"fmt"
	"math/rand"
	"time"
)

// QuickSelect 找出第 K 大的元素（K 从 1 开始）
func QuickSelect(nums []int, k int) int {
	if k < 1 || k > len(nums) {
		return -1
	}
	// 第 K 大 = 排序后索引 len(nums)-k 的元素
	target := len(nums) - k
	return quickSelectHelper(nums, 0, len(nums)-1, target)
}

func quickSelectHelper(nums []int, left, right, target int) int {
	if left == right {
		return nums[left]
	}

	pivotIdx := partition(nums, left, right)

	if pivotIdx == target {
		return nums[pivotIdx]
	} else if pivotIdx < target {
		return quickSelectHelper(nums, pivotIdx+1, right, target)
	}
	return quickSelectHelper(nums, left, pivotIdx-1, target)
}

func partition(nums []int, left, right int) int {
	// 随机选择 pivot 避免最坏情况
	rng := rand.New(rand.NewSource(time.Now().UnixNano()))
	pivotIdx := left + rng.Intn(right-left+1)
	nums[pivotIdx], nums[right] = nums[right], nums[pivotIdx]

	pivot := nums[right]
	i := left
	for j := left; j < right; j++ {
		if nums[j] <= pivot {
			nums[i], nums[j] = nums[j], nums[i]
			i++
		}
	}
	nums[i], nums[right] = nums[right], nums[i]
	return i
}

func main() {
	nums := []int{3, 2, 1, 5, 6, 4}
	fmt.Printf("第 %d 大的元素: %d\n", 2, QuickSelect(nums, 2)) // 5
}
```

### 17.1.3 实时 TopK（流式数据）

#### 问题场景

数据不是一次性给出的，而是持续流入。例如：统计热搜词 Top10，每来一条搜索记录就要更新排名。不能每次都重新排序全量数据。

#### 原理分析

核心思路与堆解法相同，但需要额外维护一个 `seen` 计数器来跟踪已见元素的累计出现次数。当已有元素再次出现时，更新堆中该元素的计数并重新堆化（`heap.Fix`），而非简单插入。

#### Go 实现

```go
package main

import (
	"container/heap"
	"fmt"
)

type Item struct {
	Value string
	Count int
}

type ItemMinHeap []Item

func (h ItemMinHeap) Len() int           { return len(h) }
func (h ItemMinHeap) Less(i, j int) bool { return h[i].Count < h[j].Count }
func (h ItemMinHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }

func (h *ItemMinHeap) Push(x interface{}) {
	*h = append(*h, x.(Item))
}

func (h *ItemMinHeap) Pop() interface{} {
	old := *h
	n := len(old)
	x := old[n-1]
	*h = old[:n-1]
	return x
}

// StreamTopK 实时 TopK 追踪器
type StreamTopK struct {
	h    *ItemMinHeap
	k    int
	seen map[string]int
}

func NewStreamTopK(k int) *StreamTopK {
	h := &ItemMinHeap{}
	heap.Init(h)
	return &StreamTopK{h: h, k: k, seen: make(map[string]int)}
}

func (s *StreamTopK) Add(value string) {
	s.seen[value]++
	count := s.seen[value]

	// 检查堆中是否已有该元素
	for i := 0; i < s.h.Len(); i++ {
		if (*s.h)[i].Value == value {
			(*s.h)[i].Count = count
			heap.Fix(s.h, i)
			return
		}
	}

	// 堆中无该元素
	if s.h.Len() < s.k {
		heap.Push(s.h, Item{Value: value, Count: count})
	} else if count > (*s.h)[0].Count {
		heap.Pop(s.h)
		heap.Push(s.h, Item{Value: value, Count: count})
	}
}

func (s *StreamTopK) GetTopK() []Item {
	result := make([]Item, s.h.Len())
	copy(result, *s.h)
	for i := 0; i < len(result); i++ {
		for j := i + 1; j < len(result); j++ {
			if result[j].Count > result[i].Count {
				result[i], result[j] = result[j], result[i]
			}
		}
	}
	return result
}

func main() {
	topK := NewStreamTopK(3)
	words := []string{
		"go", "rust", "go", "python", "go",
		"rust", "python", "go", "java", "rust",
		"go", "python", "rust", "go", "java",
	}
	for _, w := range words {
		topK.Add(w)
	}
	for _, item := range topK.GetTopK() {
		fmt.Printf("  %s: %d次\n", item.Value, item.Count)
	}
	// go: 6次, rust: 4次, python: 3次
}
```

| 方法 | 时间复杂度 | 空间复杂度 | 适用场景 |
|------|-----------|-----------|---------|
| 小顶堆 | O(N·logK) | O(K) | 通用场景，K 远小于 N |
| 快速选择 | O(N) 平均 | O(1) | 只需第 K 大/小 |
| 排序 | O(N·logN) | O(N) | 数据量小或 K 接近 N |
| 流式 TopK | O(N·logK) | O(K) | 数据流、实时统计 |

> **要点总结：**
> - 堆解法是 TopK 的通用方案，核心是"用小顶堆当筛子，堆顶就是门槛"
> - QuickSelect 只递归一侧，平均 O(N)，但最坏 O(N²)，随机化 pivot 可规避
> - 流式场景用固定大小堆维护，避免存储全量数据
> - Go 标准库 `container/heap` 需手动实现接口，注意 `Push/Pop` 是指针方法

---

## 17.2 Manacher 算法（马拉车算法）

### 问题定义

给定字符串 s，找出其中最长的回文子串。回文串是正读反读都相同的字符串，如 "aba"、"racecar"。

### 朴素解法的问题

- **暴力枚举** O(N³)：枚举所有子串 O(N²)，每个判断回文 O(N)
- **中心扩展** O(N²)：以每个位置为中心向两侧扩展，最坏扩展 O(N)

中心扩展的问题在于：每次扩展都从零开始，即使当前位置处于一个已知的大回文内部，仍然重复计算。Manacher 的核心洞察就是——**回文是对称的，对称位置的信息可以复用**。

### 17.2.1 算法原理

#### 预处理：统一奇偶

回文分奇数长度（如 "aba"，中心是字符）和偶数长度（如 "abba"，中心在两个字符之间）。处理方式不同会让代码复杂。

解决方案：在每两个字符之间插入特殊字符 `#`，首尾也加 `#`。这样所有回文都变成奇数长度：

```
原串:    a  b  a
预处理:  #  a  #  b  #  a  #
索引:    0  1  2  3  4  5  6

原串:    a  b  b  a
预处理:  #  a  #  b  #  b  #  a  #
```

进一步，在首尾加哨兵 `^` 和 `$`（不在原串中出现的字符），可以省去边界检查。

#### 回文半径数组 p[i]

定义 `p[i]` 为以位置 i 为中心的最长回文半径（含中心）。例如：

```
预处理串: ^ # a # b # a # $
索引:       0 1 2 3 4 5 6 7 8
p[i]:       0 1 2 1 4 1 2 1 0

p[4] = 4 表示以位置4('#b#')为中心，回文向左右各扩展4个位置
对应原串回文 "aba"，长度 = p[4] - 1 = 3
```

**关键公式**：原串中最长回文子串的长度 = `max(p[i]) - 1`

#### 对称性利用：核心优化

维护两个变量：
- `center`：当前已知最右回文的中心
- `maxRight`：当前已知最右回文的右边界 = center + p[center]

当处理位置 i 时：
- 如果 `i < maxRight`，说明 i 在某个已知回文的内部。i 关于 center 的对称点 `mirror = 2*center - i` 已经计算过，可以复用 `p[mirror]` 的信息
- 但 `p[i]` 不能直接等于 `p[mirror]`，因为 i 的回文可能超出 `maxRight` 的范围。所以 `p[i]` 的初始值 = `min(p[mirror], maxRight - i)`，然后继续尝试扩展

```
情况1: p[mirror] 未超出 maxRight 左边界
       ┌──────────────────────────┐
       │    mirror    center    i  │maxRight
       │      ↕         ↕       ↕ │
       │   p[mirror]   │    p[i]  │
       └──────────────────────────┘
       → p[i] 至少等于 p[mirror]，继续尝试扩展

情况2: p[mirror] 超出了 maxRight 左边界
       ┌──────────────────────────┐
       │    mirror    center    i  │maxRight
       │         ↕         ↕     │
       │         │    p[i]≤maxRight-i│
       └──────────────────────────┘
       → p[i] 只能保证到 maxRight，即 p[i] = maxRight - i
```

这就是 Manacher O(N) 的关键：每个字符最多被访问常数次（入 maxRight 一次，扩展一次）。

### 17.2.2 完整实现

```go
package main

import "fmt"

// Manacher 求最长回文子串
// 时间复杂度: O(N)，空间复杂度: O(N)
func Manacher(s string) string {
	if len(s) == 0 {
		return ""
	}

	// 预处理：插入 # 统一奇偶，加哨兵 ^$ 避免边界检查
	t := "^"
	for _, c := range s {
		t += "#" + string(c)
	}
	t += "#$"

	n := len(t)
	p := make([]int, n) // 回文半径数组
	center := 0          // 当前最右回文的中心
	maxRight := 0       // 当前最右回文的右边界
	maxCenter := 0      // 全局最大回文的中心

	for i := 1; i < n-1; i++ {
		mirror := 2*center - i // i 关于 center 的对称点

		if i < maxRight {
			// 利用对称性，p[i] 至少为 min(p[mirror], maxRight-i)
			p[i] = min(maxRight-i, p[mirror])
		}

		// 尝试扩展回文半径
		for t[i+(1+p[i])] == t[i-(1+p[i])] {
			p[i]++
		}

		// 更新最右回文
		if i+p[i] > maxRight {
			center = i
			maxRight = i + p[i]
		}

		// 更新全局最大回文
		if p[i] > p[maxCenter] {
			maxCenter = i
		}
	}

	// 还原到原串
	start := (maxCenter - p[maxCenter]) / 2
	length := p[maxCenter]
	return s[start : start+length]
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	testCases := []string{
		"babad",        // bab 或 aba
		"cbbd",         // bb
		"racecar",      // racecar
		"abacdfgdcaba", // aba
	}
	for _, s := range testCases {
		fmt.Printf("输入: %-15s → 最长回文子串: %s\n", s, Manacher(s))
	}
}
```

### 17.2.3 回文子串计数

`p[i]` 还有一个重要性质：以位置 i 为中心的回文子串个数等于 `p[i]`（在预处理串中）。还原到原串，每个回文半径对应一个原串回文子串。

```go
// CountPalindromes 统计字符串中所有回文子串的数量
// 时间复杂度: O(N)
func CountPalindromes(s string) int {
	if len(s) == 0 {
		return 0
	}

	t := "^"
	for _, c := range s {
		t += "#" + string(c)
	}
	t += "#$"

	n := len(t)
	p := make([]int, n)
	center, maxRight := 0, 0
	count := 0

	for i := 1; i < n-1; i++ {
		mirror := 2*center - i
		if i < maxRight {
			p[i] = min(maxRight-i, p[mirror])
		}
		for t[i+(1+p[i])] == t[i-(1+p[i])] {
			p[i]++
		}
		if i+p[i] > maxRight {
			center = i
			maxRight = i + p[i]
		}
		// 预处理串中每个回文半径对应原串一个回文子串
		// 奇数半径(字符中心)和偶数半径(#中心)各贡献 (p[i]+1)/2 和 p[i]/2
		count += (p[i] + 1) / 2
	}

	return count
}
```

| 方法 | 时间复杂度 | 空间复杂度 | 特点 |
|------|-----------|-----------|------|
| 暴力 | O(N³) | O(1) | 简单直观，仅适合极小数据 |
| 中心扩展 | O(N²) | O(1) | 易理解，面试够用 |
| Manacher | O(N) | O(N) | 最优解，利用对称性避免重复 |
| DP | O(N²) | O(N²) | 可扩展到其他回文问题 |

> **要点总结：**
> - Manacher 的核心是利用回文的对称性，通过 `mirror` 复用已计算信息，避免重复扩展
> - 预处理插入 `#` 统一了奇偶长度回文的处理，哨兵 `^$` 消除边界检查
> - `p[i]` 不仅用于求最长回文，还可统计回文子串数量
> - 面试中如果只要求 O(N²)，中心扩展法足够；要求 O(N) 时才需要 Manacher

---

## 17.3 动态规划（Dynamic Programming）

### 核心思想

动态规划解决的是具有**重叠子问题**和**最优子结构**的问题。与分治的区别在于：分治的子问题互不重叠，而 DP 的子问题会重复出现，通过记忆化或递推避免重复计算。

### 解题框架

```
1. 定义状态：dp[i] 或 dp[i][j] 表示什么？
2. 状态转移方程：dp[i] 如何从子问题推导？
3. 初始条件：dp 的边界值是什么？
4. 计算顺序：自底向上（递推）还是自顶向下（记忆化）？
5. 结果提取：最终答案在 dp 的哪个位置？
```

### 17.3.1 0-1 背包

#### 问题定义

给定 N 个物品（重量 `w[i]`，价值 `v[i]`）和容量为 W 的背包，每个物品**只能选一次**，求最大价值。

#### 状态转移分析

对每个物品，只有两种选择：选或不选。

```
dp[i][j] = 前 i 个物品、容量为 j 时的最大价值

不选物品 i: dp[i][j] = dp[i-1][j]
选物品 i:   dp[i][j] = dp[i-1][j-w[i]] + v[i]  (前提: j ≥ w[i])

取两者较大值:
dp[i][j] = max(dp[i-1][j], dp[i-1][j-w[i]] + v[i])
```

#### 空间优化：二维 → 一维

观察转移方程：`dp[i][j]` 只依赖 `dp[i-1][...]`，即上一行。可以用一维数组，但**必须逆序遍历**：

为什么逆序？因为正序遍历时，`dp[j-w[i]]` 可能已经被当前轮次更新过（即已经"选了"物品 i），导致物品被重复选择。逆序保证 `dp[j-w[i]]` 还是上一轮的值。

```
正序遍历（错误）: dp[j] = max(dp[j], dp[j-w]+v)
  j=2: dp[2] = dp[2-w]+v  ← dp[2-w] 可能已被本轮更新
  → 物品被选了多次（变成了完全背包）

逆序遍历（正确）: dp[j] = max(dp[j], dp[j-w]+v)
  j=W: dp[W] = dp[W-w]+v  ← dp[W-w] 还是上一轮的值
  → 每个物品只选一次
```

#### Go 实现

```go
package main

import "fmt"

// Knapsack01 0-1背包（二维DP）
// 时间: O(N·W)，空间: O(N·W)
func Knapsack01(weights, values []int, capacity int) int {
	n := len(weights)
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, capacity+1)
	}

	for i := 1; i <= n; i++ {
		w, v := weights[i-1], values[i-1]
		for j := 0; j <= capacity; j++ {
			dp[i][j] = dp[i-1][j] // 不选
			if j >= w {
				dp[i][j] = max(dp[i][j], dp[i-1][j-w]+v)
			}
		}
	}

	return dp[n][capacity]
}

// Knapsack01Optimized 0-1背包（一维优化）
// 时间: O(N·W)，空间: O(W)
func Knapsack01Optimized(weights, values []int, capacity int) int {
	dp := make([]int, capacity+1)

	for i := 0; i < len(weights); i++ {
		for j := capacity; j >= weights[i]; j-- { // 逆序！
			dp[j] = max(dp[j], dp[j-weights[i]]+values[i])
		}
	}

	return dp[capacity]
}

// Knapsack01WithPath 0-1背包（回溯选中的物品）
func Knapsack01WithPath(weights, values []int, capacity int) (int, []int) {
	n := len(weights)
	dp := make([][]int, n+1)
	for i := range dp {
		dp[i] = make([]int, capacity+1)
	}

	for i := 1; i <= n; i++ {
		w, v := weights[i-1], values[i-1]
		for j := 0; j <= capacity; j++ {
			dp[i][j] = dp[i-1][j]
			if j >= w {
				dp[i][j] = max(dp[i][j], dp[i-1][j-w]+v)
			}
		}
	}

	// 回溯：从 dp[n][capacity] 往回推
	selected := []int{}
	j := capacity
	for i := n; i >= 1; i-- {
		if dp[i][j] != dp[i-1][j] {
			// 物品 i-1 被选中
			selected = append(selected, i-1)
			j -= weights[i-1]
		}
	}

	return dp[n][capacity], selected
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func main() {
	weights := []int{2, 3, 4, 5}
	values := []int{3, 4, 5, 6}
	capacity := 8

	fmt.Printf("二维DP: 最大价值 = %d\n", Knapsack01(weights, values, capacity))
	fmt.Printf("一维优化: 最大价值 = %d\n", Knapsack01Optimized(weights, values, capacity))

	maxVal, selected := Knapsack01WithPath(weights, values, capacity)
	fmt.Printf("带路径: 最大价值 = %d, 选中物品索引 = %v\n", maxVal, selected)
}
```

### 17.3.2 最长公共子序列（LCS）

#### 问题定义

给定两个字符串，求它们的最长公共子序列（子序列可以不连续）的长度。

#### 状态转移分析

```
dp[i][j] = s1[0:i] 与 s2[0:j] 的 LCS 长度

情况1: s1[i-1] == s2[j-1]
  两个字符相同，必然加入 LCS:
  dp[i][j] = dp[i-1][j-1] + 1

情况2: s1[i-1] != s2[j-1]
  两个字符不同，至少有一个不在 LCS 中，取较大值:
  dp[i][j] = max(dp[i-1][j], dp[i][j-1])
```

图解：

```
s1 = "ABCBDAB", s2 = "BDCABA"

      ""  B  D  C  A  B  A
  ""   0  0  0  0  0  0  0
  A    0  0  0  0  1  1  1
  B    0  1  1  1  1  2  2
  C    0  1  1  2  2  2  2
  B    0  1  1  2  2  3  3
  D    0  1  2  2  2  3  3
  A    0  1  2  2  3  3  4
  B    0  1  2  2  3  4  4

LCS 长度 = 4，回溯可得 "BCBA" 或 "BDAB"
```

#### Go 实现

```go
package main

import "fmt"

// LCS 最长公共子序列长度
// 时间: O(M·N)，空间: O(M·N)
func LCS(s1, s2 string) int {
	m, n := len(s1), len(s2)
	dp := make([][]int, m+1)
	for i := range dp {
		dp[i] = make([]int, n+1)
	}

	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if s1[i-1] == s2[j-1] {
				dp[i][j] = dp[i-1][j-1] + 1
			} else {
				dp[i][j] = max(dp[i-1][j], dp[i][j-1])
			}
		}
	}

	return dp[m][n]
}

// LCSString 返回具体的最长公共子序列
func LCSString(s1, s2 string) string {
	m, n := len(s1), len(s2)
	dp := make([][]int, m+1)
	for i := range dp {
		dp[i] = make([]int, n+1)
	}

	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if s1[i-1] == s2[j-1] {
				dp[i][j] = dp[i-1][j-1] + 1
			} else {
				dp[i][j] = max(dp[i-1][j], dp[i][j-1])
			}
		}
	}

	// 回溯构造子序列
	result := make([]byte, 0, dp[m][n])
	i, j := m, n
	for i > 0 && j > 0 {
		if s1[i-1] == s2[j-1] {
			result = append(result, s1[i-1])
			i--
			j--
		} else if dp[i-1][j] > dp[i][j-1] {
			i--
		} else {
			j--
		}
	}

	// 反转
	for l, r := 0, len(result)-1; l < r; l, r = l+1, r-1 {
		result[l], result[r] = result[r], result[l]
	}

	return string(result)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func main() {
	s1, s2 := "ABCBDAB", "BDCABA"
	fmt.Printf("LCS 长度: %d\n", LCS(s1, s2))        // 4
	fmt.Printf("LCS 子序列: %s\n", LCSString(s1, s2)) // BCBA 或 BDAB
}
```

### 17.3.3 最长递增子序列（LIS）

#### 问题定义

给定整数数组，求最长严格递增子序列的长度。子序列可以不连续。

#### 方法一：O(N²) DP

```
dp[i] = 以 nums[i] 结尾的 LIS 长度

dp[i] = max(dp[j] + 1)  对所有 j < i 且 nums[j] < nums[i]
初始: dp[i] = 1（每个元素自身构成长度为1的递增子序列）
```

#### 方法二：O(N·logN) 贪心 + 二分

**核心思想**：维护数组 `tails`，`tails[i]` 表示长度为 `i+1` 的递增子序列的**最小末尾元素**。

为什么维护最小末尾？因为末尾越小，后续元素越容易接上去，LIS 就越长。这是一种贪心策略。

```
nums = [10, 9, 2, 5, 3, 7, 101, 18]

处理过程:
10 → tails = [10]          (长度1的LIS末尾最小是10)
9  → tails = [9]           (9 < 10，替换10，更小的末尾更有潜力)
2  → tails = [2]           (2 < 9，替换9)
5  → tails = [2, 5]        (5 > 2，可以扩展长度2的LIS)
3  → tails = [2, 3]        (3 < 5，替换5，长度2的LIS末尾更小)
7  → tails = [2, 3, 7]     (7 > 3，扩展长度3)
101→ tails = [2, 3, 7, 101] (扩展长度4)
18 → tails = [2, 3, 7, 18]  (18 < 101，替换101)

LIS 长度 = len(tails) = 4
注意: tails 不是实际的 LIS，只是长度正确
```

#### Go 实现

```go
package main

import "fmt"

// LISDP O(N²) 动态规划解法
func LISDP(nums []int) int {
	if len(nums) == 0 {
		return 0
	}
	n := len(nums)
	dp := make([]int, n)
	for i := range dp {
		dp[i] = 1
	}

	maxLen := 1
	for i := 1; i < n; i++ {
		for j := 0; j < i; j++ {
			if nums[j] < nums[i] {
				dp[i] = max(dp[i], dp[j]+1)
			}
		}
		maxLen = max(maxLen, dp[i])
	}
	return maxLen
}

// LISBinary O(N·logN) 贪心 + 二分
func LISBinary(nums []int) int {
	if len(nums) == 0 {
		return 0
	}

	tails := []int{} // tails[i] = 长度为 i+1 的 LIS 的最小末尾

	for _, num := range nums {
		// 二分查找：找到第一个 >= num 的位置
		left, right := 0, len(tails)
		for left < right {
			mid := left + (right-left)/2
			if tails[mid] < num {
				left = mid + 1
			} else {
				right = mid
			}
		}

		if left == len(tails) {
			tails = append(tails, num) // 扩展
		} else {
			tails[left] = num // 替换，保持更小末尾
		}
	}

	return len(tails)
}

// LISWithPath 求最长递增子序列（返回具体子序列）
func LISWithPath(nums []int) []int {
	if len(nums) == 0 {
		return nil
	}

	n := len(nums)
	dp := make([]int, n)
	prev := make([]int, n) // 前驱数组，用于回溯
	for i := range dp {
		dp[i] = 1
		prev[i] = -1
	}

	maxLen, maxIdx := 1, 0
	for i := 1; i < n; i++ {
		for j := 0; j < i; j++ {
			if nums[j] < nums[i] && dp[j]+1 > dp[i] {
				dp[i] = dp[j] + 1
				prev[i] = j
			}
		}
		if dp[i] > maxLen {
			maxLen = dp[i]
			maxIdx = i
		}
	}

	// 回溯构造子序列
	result := make([]int, 0, maxLen)
	for idx := maxIdx; idx != -1; idx = prev[idx] {
		result = append(result, nums[idx])
	}

	for l, r := 0, len(result)-1; l < r; l, r = l+1, r-1 {
		result[l], result[r] = result[r], result[l]
	}
	return result
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func main() {
	nums := []int{10, 9, 2, 5, 3, 7, 101, 18}
	fmt.Printf("LIS 长度(DP): %d\n", LISDP(nums))       // 4
	fmt.Printf("LIS 长度(二分): %d\n", LISBinary(nums))   // 4
	fmt.Printf("LIS 子序列: %v\n", LISWithPath(nums))      // [2 3 7 18]
}
```

### 17.3.4 编辑距离

#### 问题定义

给定两个字符串 `word1` 和 `word2`，求将 `word1` 转换为 `word2` 的最少操作次数。允许三种操作：插入、删除、替换。

#### 状态转移分析

```
dp[i][j] = word1[0:i] 转换为 word2[0:j] 的最少操作数

情况1: word1[i-1] == word2[j-1]
  字符相同，无需操作:
  dp[i][j] = dp[i-1][j-1]

情况2: word1[i-1] != word2[j-1]
  三种操作取最小:
  dp[i][j] = 1 + min(
      dp[i-1][j],     // 删除 word1[i-1]（word1 少一个字符）
      dp[i][j-1],     // 插入 word2[j-1]（word1 多一个字符）
      dp[i-1][j-1],   // 替换 word1[i-1] → word2[j-1]
  )
```

为什么这三种操作是完备的？

- **删除**：word1 多了一个不该有的字符，删掉它，问题变成 `word1[0:i-1]` → `word2[0:j]`
- **插入**：word1 少了一个字符，在 word1 末尾插入 word2[j-1]，问题变成 `word1[0:i]` → `word2[0:j-1]`
- **替换**：word1[i-1] 和 word2[j-1] 不同，把 word1[i-1] 替换成 word2[j-1]，问题变成 `word1[0:i-1]` → `wordword2[0:j-1]`

#### Go 实现

```go
package main

import "fmt"

// EditDistance 编辑距离
// 时间: O(M·N)，空间: O(M·N)
func EditDistance(word1, word2 string) int {
	m, n := len(word1), len(word2)
	dp := make([][]int, m+1)
	for i := range dp {
		dp[i] = make([]int, n+1)
	}

	// 边界：空串转换
	for i := 0; i <= m; i++ {
		dp[i][0] = i // 删除 i 次
	}
	for j := 0; j <= n; j++ {
		dp[0][j] = j // 插入 j 次
	}

	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			if word1[i-1] == word2[j-1] {
				dp[i][j] = dp[i-1][j-1]
			} else {
				dp[i][j] = 1 + min3(
					dp[i-1][j],   // 删除
					dp[i][j-1],   // 插入
					dp[i-1][j-1], // 替换
				)
			}
		}
	}

	return dp[m][n]
}

func min3(a, b, c int) int {
	if a < b {
		if a < c {
			return a
		}
		return c
	}
	if b < c {
		return b
	}
	return c
}

func main() {
	pairs := []struct{ w1, w2 string }{
		{"horse", "ros"},       // 3
		{"intention", "execution"}, // 5
		{"kitten", "sitting"}, // 3
	}
	for _, p := range pairs {
		fmt.Printf("edit_distance(%q, %q) = %d\n", p.w1, p.w2, EditDistance(p.w1, p.w2))
	}
}
```

### 17.3.5 完全背包

#### 与 0-1 背包的区别

完全背包中每种物品可以选**无限次**。状态转移方程形式相同，但一维优化时**正序遍历**：

```
0-1 背包: for j := capacity; j >= w; j--  (逆序，保证每个物品只选一次)
完全背包: for j := w; j <= capacity; j++  (正序，允许重复选择)
```

为什么正序可以重复选？因为 `dp[j-w]` 可能在本轮已经被更新过（即已经选了物品 i），再次使用时相当于又选了一次。

#### 经典变体：零钱兑换

```go
package main

import "fmt"

// UnboundedKnapsack 完全背包（求最大价值）
func UnboundedKnapsack(weights, values []int, capacity int) int {
	dp := make([]int, capacity+1)
	for i := 0; i < len(weights); i++ {
		for j := weights[i]; j <= capacity; j++ { // 正序！
			dp[j] = max(dp[j], dp[j-weights[i]]+values[i])
		}
	}
	return dp[capacity]
}

// CoinChange 零钱兑换（求最少硬币数）
func CoinChange(coins []int, amount int) int {
	const INF = int(1e9)
	dp := make([]int, amount+1)
	for i := range dp {
		dp[i] = INF
	}
	dp[0] = 0

	for _, coin := range coins {
		for j := coin; j <= amount; j++ {
			dp[j] = min(dp[j], dp[j-coin]+1)
		}
	}

	if dp[amount] == INF {
		return -1
	}
	return dp[amount]
}

// CoinChangeWays 零钱兑换（求组合数）
func CoinChangeWays(coins []int, amount int) int {
	dp := make([]int, amount+1)
	dp[0] = 1 // 凑出金额0的方式为1（不选任何硬币）

	for _, coin := range coins {
		for j := coin; j <= amount; j++ {
			dp[j] += dp[j-coin]
		}
	}
	return dp[amount]
}

func max(a, b int) int {
	if a > b { return a }
	return b
}
func min(a, b int) int {
	if a < b { return a }
	return b
}

func main() {
	// 完全背包
	weights := []int{1, 3, 4}
	values := []int{15, 20, 30}
	fmt.Printf("完全背包最大价值: %d\n", UnboundedKnapsack(weights, values, 4))

	// 零钱兑换
	fmt.Printf("最少硬币数: %d\n", CoinChange([]int{1, 5, 11}, 15)) // 3 (5+5+5)
	fmt.Printf("组合数: %d\n", CoinChangeWays([]int{1, 2, 5}, 5))     // 4
}
```

### 17.3.6 最长回文子序列

#### 问题定义

给定字符串，求最长回文子序列的长度。注意：子序列可以不连续，与子串不同。

#### 状态转移分析

```
dp[i][j] = s[i:j+1] 中最长回文子序列的长度

情况1: s[i] == s[j]
  两端字符相同，它们可以构成回文的两端:
  dp[i][j] = dp[i+1][j-1] + 2  (i != j 时)
  dp[i][j] = 1                  (i == j 时，单个字符)

情况2: s[i] != s[j]
  两端字符不同，至少有一个不在回文中:
  dp[i][j] = max(dp[i+1][j], dp[i][j-1])
```

遍历顺序：因为 `dp[i][j]` 依赖 `dp[i+1][j-1]`、`dp[i+1][j]`、`dp[i][j-1]`，即依赖左下、下方、左方，所以**从下往上、从左往右**填充。

#### Go 实现

```go
package main

import "fmt"

// LongestPalindromeSubseq 最长回文子序列
// 时间: O(N²)，空间: O(N²)
func LongestPalindromeSubseq(s string) int {
	n := len(s)
	if n == 0 {
		return 0
	}

	dp := make([][]int, n)
	for i := range dp {
		dp[i] = make([]int, n)
		dp[i][i] = 1 // 单个字符是长度为1的回文
	}

	// 从下往上、从左往右
	for i := n - 2; i >= 0; i-- {
		for j := i + 1; j < n; j++ {
			if s[i] == s[j] {
				dp[i][j] = dp[i+1][j-1] + 2
			} else {
				dp[i][j] = max(dp[i+1][j], dp[i][j-1])
			}
		}
	}

	return dp[0][n-1]
}

func max(a, b int) int {
	if a > b { return a }
	return b
}

func main() {
	testCases := []string{"bbbab", "cbbd", "a", "abc"}
	for _, s := range testCases {
		fmt.Printf("LPS(%q) = %d\n", s, LongestPalindromeSubseq(s))
	}
	// LPS("bbbab") = 4 (bbbb)
	// LPS("cbbd")  = 2 (bb)
	// LPS("a")     = 1
	// LPS("abc")   = 1
}
```

### DP 问题分类速查

| 类别 | 代表问题 | 状态定义 | 时间复杂度 |
|------|---------|----------|-----------|
| 线性 DP | LIS、最大子数组和 | `dp[i]` = 以 i 结尾的最优值 | O(N) ~ O(N²) |
| 区间 DP | 最长回文子序列、矩阵链乘 | `dp[i][j]` = 区间 [i,j] 的最优值 | O(N²) ~ O(N³) |
| 背包 DP | 0-1背包、完全背包 | `dp[i][j]` = 前 i 个物品容量 j 的最优值 | O(N·W) |
| 字符串 DP | LCS、编辑距离 | `dp[i][j]` = 两串前缀的最优值 | O(M·N) |
| 树形 DP | 树的最大独立集 | `dp[node][0/1]` = 选/不选当前节点 | O(N) |
| 状态压缩 DP | 旅行商问题 | `dp[mask][i]` = 经过集合 mask 最后在 i | O(2^N·N) |

> **要点总结：**
> - DP 的核心是**定义状态**和**推导转移方程**，先想清楚"dp 数组代表什么"
> - 空间优化是常见考点：二维→一维的关键是遍历顺序（0-1 背包逆序，完全背包正序）
> - 区间 DP 的遍历顺序是"先短后长"（先算小区间，再算大区间）
> - 回溯路径需要额外的前驱数组，不能仅靠 dp 值还原
> - 面试中先写 O(N²) 的朴素解法，再考虑优化，不要一上来就写最优化版本

---

## 17.4 并查集（Union-Find）

### 问题定义

并查集处理的是**动态连通性**问题：给定 N 个元素和一系列操作（合并两个集合、查询两个元素是否在同一集合），高效地维护集合关系。

典型场景：图的连通分量、Kruskal 最小生成树、朋友圈/省份数量、等式方程的可满足性。

### 原理分析

#### 核心操作

- **Find(x)**：找到 x 所属集合的根（代表元素）
- **Union(x, y)**：将 x 和 y 所在的集合合并

#### 朴素实现的问题

直接用数组 `parent[i]` 表示 i 的父节点，Find 操作需要沿父指针一直往上找，最坏情况形成链表，Find 和 Union 都是 O(N)。

#### 路径压缩

Find 时，将沿途所有节点直接挂到根上，下次查询就是 O(1)：

```
压缩前:          压缩后:
    1               1
   / \            / | \
  2   3    →     2  3  4
 /
4
```

#### 按秩合并

Union 时，将较矮的树挂到较高的树下，避免树退化成链表。"秩"可以理解为树的高度上界。

#### 复杂度

路径压缩 + 按秩合并后，单次操作的均摊复杂度为 **O(α(N))**，其中 α 是反阿克曼函数，增长极慢，实际中可视为常数。

### Go 实现

```go
package main

import "fmt"

// UnionFind 并查集（带路径压缩 + 按秩合并）
type UnionFind struct {
	parent []int // 父节点
	rank   []int // 秩（树高度上界）
	count  int   // 连通分量数
}

func NewUnionFind(n int) *UnionFind {
	uf := &UnionFind{
		parent: make([]int, n),
		rank:   make([]int, n),
		count:  n,
	}
	for i := 0; i < n; i++ {
		uf.parent[i] = i // 初始时每个元素自成一派
		uf.rank[i] = 1
	}
	return uf
}

// Find 查找根节点（带路径压缩）
func (uf *UnionFind) Find(x int) int {
	if uf.parent[x] != x {
		uf.parent[x] = uf.Find(uf.parent[x]) // 递归压缩路径
	}
	return uf.parent[x]
}

// Union 合并两个集合（按秩合并）
func (uf *UnionFind) Union(x, y int) {
	rootX, rootY := uf.Find(x), uf.Find(y)
	if rootX == rootY {
		return // 已在同一集合
	}

	// 将矮树挂到高树下
	if uf.rank[rootX] < uf.rank[rootY] {
		uf.parent[rootX] = rootY
	} else if uf.rank[rootX] > uf.rank[rootY] {
		uf.parent[rootY] = rootX
	} else {
		uf.parent[rootY] = rootX
		uf.rank[rootX]++ // 等高时，合并后高度+1
	}
	uf.count--
}

// Connected 判断两个元素是否在同一集合
func (uf *UnionFind) Connected(x, y int) bool {
	return uf.Find(x) == uf.Find(y)
}

// Count 返回连通分量数
func (uf *UnionFind) Count() int {
	return uf.count
}

func main() {
	// 示例：省份数量（LeetCode 547）
	// isConnected[i][j] = 1 表示城市 i 和 j 直接相连
	isConnected := [][]int{
		{1, 1, 0},
		{1, 1, 0},
		{0, 0, 1},
	}

	n := len(isConnected)
	uf := NewUnionFind(n)

	for i := 0; i < n; i++ {
		for j := i + 1; j < n; j++ {
			if isConnected[i][j] == 1 {
				uf.Union(i, j)
			}
		}
	}

	fmt.Printf("省份数量: %d\n", uf.Count()) // 2
}
```

> **要点总结：**
> - 并查集的核心是 Find（路径压缩）和 Union（按秩合并），两者配合达到近 O(1) 的均摊复杂度
> - 路径压缩让树变扁平，按秩合并让树不退化，缺一不可
> - 典型应用：连通分量、Kruskal 最小生成树、等式方程可满足性

---

## 17.5 单调栈

### 问题定义

单调栈维护一个单调递增（或递减）的栈结构，用于高效求解"下一个更大/更小元素"、"柱状图最大矩形"等问题。

### 原理分析

核心思想：**栈中只保留"有希望"的元素**。当新元素到来时，如果它比栈顶更优（比如求下一个更大元素时，新元素更小），就入栈；否则弹出栈顶，因为栈顶找到了答案。

以"下一个更大元素"为例：

```
输入: [2, 1, 2, 4, 3]

i=0: 栈=[], 2入栈                    → 栈=[2]
i=1: 栈=[2], 1<2, 1入栈              → 栈=[2,1]
i=2: 栈=[2,1], 2>1, 弹出1, ans[1]=2  → 栈=[2]
      2==2, 不弹, 2入栈              → 栈=[2,2]
i=3: 栈=[2,2], 4>2, 弹出2, ans[2]=4  → 栈=[2]
      4>2, 弹出2, ans[0]=4            → 栈=[]
      4入栈                           → 栈=[4]
i=4: 栈=[4], 3<4, 3入栈              → 栈=[4,3]

栈中剩余元素没有下一个更大元素, ans = [4, 2, 4, -1, -1]
```

每个元素最多入栈一次、出栈一次，所以总时间复杂度是 **O(N)**。

### Go 实现

```go
package main

import "fmt"

// NextGreaterElement 下一个更大元素
// 时间: O(N)，空间: O(N)
func NextGreaterElement(nums []int) []int {
	n := len(nums)
	result := make([]int, n)
	for i := range result {
		result[i] = -1 // 默认没有更大元素
	}

	stack := []int{} // 栈存索引，不存值

	for i := 0; i < n; i++ {
		for len(stack) > 0 && nums[i] > nums[stack[len(stack)-1]] {
			// 当前元素比栈顶大，栈顶找到了下一个更大元素
			top := stack[len(stack)-1]
			result[top] = nums[i]
			stack = stack[:len(stack)-1]
		}
		stack = append(stack, i)
	}

	return result
}

// DailyTemperatures 每日温度（下一个更大元素的索引距离）
// LeetCode 739: 给定温度列表，返回列表中比当天温度高的下一个日期的间隔
func DailyTemperatures(temperatures []int) []int {
	n := len(temperatures)
	result := make([]int, n)
	stack := []int{} // 栈存索引

	for i := 0; i < n; i++ {
		for len(stack) > 0 && temperatures[i] > temperatures[stack[len(stack)-1]] {
			top := stack[len(stack)-1]
			result[top] = i - top // 间隔天数
			stack = stack[:len(stack)-1]
		}
		stack = append(stack, i)
	}

	return result
}

// LargestRectangleArea 柱状图中的最大矩形
// LeetCode 84: 核心单调栈应用
// 时间: O(N)，空间: O(N)
func LargestRectangleArea(heights []int) int {
	// 首尾加0，确保所有柱子都能被处理
	heights = append([]int{0}, heights...)
	heights = append(heights, 0)

	stack := []int{}
	maxArea := 0

	for i := 0; i < len(heights); i++ {
		for len(stack) > 0 && heights[i] < heights[stack[len(stack)-1]] {
			// 栈顶柱子的高度大于当前柱子，可以计算以栈顶为高的矩形面积
			h := heights[stack[len(stack)-1]]
			stack = stack[:len(stack)-1]

			// 矩形宽度 = 右边界 - 左边界 - 1
			left := stack[len(stack)-1]
			width := i - left - 1
			maxArea = max(maxArea, h*width)
		}
		stack = append(stack, i)
	}

	return maxArea
}

func max(a, b int) int {
	if a > b { return a }
	return b
}

func main() {
	// 下一个更大元素
	nums := []int{2, 1, 2, 4, 3}
	fmt.Printf("下一个更大元素: %v\n", NextGreaterElement(nums))
	// [4, 2, 4, -1, -1]

	// 每日温度
	temps := []int{73, 74, 75, 71, 69, 72, 76, 73}
	fmt.Printf("等待天数: %v\n", DailyTemperatures(temps))
	// [1, 1, 4, 2, 1, 1, 0, 0]

	// 柱状图最大矩形
	heights := []int{2, 1, 5, 6, 2, 3}
	fmt.Printf("最大矩形面积: %d\n", LargestRectangleArea(heights))
	// 10 (柱子5和6组成的矩形，宽2高5)
}
```

> **要点总结：**
> - 单调栈的核心是"弹栈时处理答案"，每个元素最多入栈出栈各一次，总 O(N)
> - 求下一个更大元素用单调递减栈，求下一个更小元素用单调递增栈
> - 柱状图最大矩形是经典变体，首尾加 0 简化边界处理
> - 循环数组的下一个更大元素需要遍历两遍（取模）

---

## 17.6 前缀和与差分

### 问题定义

- **前缀和**：快速求区间和 `sum[l..r]`，将 O(N) 的累加降到 O(1)
- **差分**：快速对区间 `[l..r]` 批量加减，将 O(N) 的修改降到 O(1)

两者是互逆操作：差分数组的前缀和 = 原数组，原数组的差分 = 差分数组。

### 原理分析

#### 一维前缀和

```
原数组:    a[0]  a[1]  a[2]  a[3]  a[4]
前缀和:    s[0]  s[1]  s[2]  s[3]  s[4]
其中: s[i] = a[0] + a[1] + ... + a[i]

区间和: sum[l..r] = s[r] - s[l-1]  (l > 0)
       sum[0..r] = s[r]
```

预处理 O(N)，每次查询 O(1)。

#### 二维前缀和

```
s[i][j] = 以 (0,0) 为左上角、(i,j) 为右下角的矩形区域和

子矩阵和:
sum(x1,y1,x2,y2) = s[x2][y2] - s[x1-1][y2] - s[x2][y1-1] + s[x1-1][y1-1]
```

#### 差分数组

```
原数组:    a[0]  a[1]  a[2]  a[3]  a[4]
差分数组:  d[0]  d[1]  d[2]  d[3]  d[4]
其中: d[0] = a[0]
     d[i] = a[i] - a[i-1]  (i > 0)

对区间 [l..r] 加 val:
  d[l] += val
  d[r+1] -= val  (如果 r+1 < n)

还原: a[i] = d[0] + d[1] + ... + d[i]  (前缀和)
```

### Go 实现

```go
package main

import "fmt"

// ========== 一维前缀和 ==========

type PrefixSum1D struct {
	sums []int // sums[i] = a[0] + a[1] + ... + a[i]
}

func NewPrefixSum1D(nums []int) *PrefixSum1D {
	sums := make([]int, len(nums))
	sums[0] = nums[0]
	for i := 1; i < len(nums); i++ {
		sums[i] = sums[i-1] + nums[i]
	}
	return &PrefixSum1D{sums: sums}
}

// Query 求 nums[l..r] 的区间和，O(1)
func (ps *PrefixSum1D) Query(l, r int) int {
	if l == 0 {
		return ps.sums[r]
	}
	return ps.sums[r] - ps.sums[l-1]
}

// ========== 二维前缀和 ==========

type PrefixSum2D struct {
	sums [][]int // sums[i][j] = 以(0,0)为左上角、(i,j)为右下角的矩形区域和
}

func NewPrefixSum2D(matrix [][]int) *PrefixSum2D {
	m, n := len(matrix), len(matrix[0])
	sums := make([][]int, m+1)
	for i := range sums {
		sums[i] = make([]int, n+1)
	}

	for i := 1; i <= m; i++ {
		for j := 1; j <= n; j++ {
			sums[i][j] = matrix[i-1][j-1] + sums[i-1][j] + sums[i][j-1] - sums[i-1][j-1]
		}
	}

	return &PrefixSum2D{sums: sums}
}

// Query 求 (x1,y1) 到 (x2,y2) 的子矩阵和，O(1)
// 坐标从 0 开始
func (ps *PrefixSum2D) Query(x1, y1, x2, y2 int) int {
	return ps.sums[x2+1][y2+1] - ps.sums[x1][y2+1] - ps.sums[x2+1][y1] + ps.sums[x1][y1]
}

// ========== 差分数组 ==========

type DiffArray struct {
	diff []int
	n    int
}

func NewDiffArray(n int) *DiffArray {
	return &DiffArray{diff: make([]int, n+1), n: n} // 多一个位置用于 r+1
}

// Add 对区间 [l..r] 加 val，O(1)
func (da *DiffArray) Add(l, r, val int) {
	da.diff[l] += val
	da.diff[r+1] -= val
}

// Restore 还原原数组，O(N)
func (da *DiffArray) Restore() []int {
	result := make([]int, da.n)
	result[0] = da.diff[0]
	for i := 1; i < da.n; i++ {
		result[i] = result[i-1] + da.diff[i]
	}
	return result
}

func main() {
	// 一维前缀和
	nums := []int{1, 3, 5, 7, 9}
	ps1d := NewPrefixSum1D(nums)
	fmt.Printf("sum[1..3] = %d\n", ps1d.Query(1, 3)) // 3+5+7 = 15
	fmt.Printf("sum[0..4] = %d\n", ps1d.Query(0, 4)) // 1+3+5+7+9 = 25

	// 二维前缀和
	matrix := [][]int{
		{1, 2, 3},
		{4, 5, 6},
		{7, 8, 9},
	}
	ps2d := NewPrefixSum2D(matrix)
	fmt.Printf("子矩阵(0,0)-(1,1)和 = %d\n", ps2d.Query(0, 0, 1, 1)) // 1+2+4+5 = 12

	// 差分数组
	da := NewDiffArray(5)
	da.Add(1, 3, 10) // 对 [1..3] 加 10
	da.Add(2, 4, 5)   // 对 [2..4] 加 5
	fmt.Printf("差分还原: %v\n", da.Restore()) // [0, 10, 15, 15, 5]
}
```

> **要点总结：**
> - 前缀和将区间求和从 O(N) 降到 O(1)，差分将区间修改从 O(N) 降到 O(1)
> - 两者互逆：差分数组的前缀和 = 原数组
> - 二维前缀和注意容斥原理：`s[x2][y2] - s[x1-1][y2] - s[x2][y1-1] + s[x1-1][y1-1]`
> - 差分数组大小为 N+1，避免 `r+1` 越界

---

## 17.7 KMP 字符串匹配

### 问题定义

在文本串 `text` 中查找模式串 `pattern` 的所有出现位置。朴素解法最坏 O(M·N)，KMP 算法达到 O(M+N)。

### 原理分析

#### 朴素匹配的问题

当模式串在某个位置匹配失败时，朴素算法将模式串右移一位，从头开始匹配。这浪费了之前已经匹配的信息。

```
text:    A B A B A B C
pattern: A B A B D
                 ↑ 失配

朴素做法：模式串右移1位，从头匹配
  text:    A B A B A B C
  pattern:   A B A B D
              ↑ 从头开始，但之前已经匹配了 "AB"，不需要重新匹配
```

#### next 数组（部分匹配表）

`next[i]` 表示 `pattern[0..i]` 这个子串中，**最长相等前后缀**的长度。

```
pattern: A B A B A
索引:    0 1 2 3 4
next:    0 0 1 2 3

解释:
  next[0] = 0  "A" 的最长相等前后缀长度为0
  next[1] = 0  "AB" 没有相等前后缀
  next[2] = 1  "ABA" → 前缀"A" = 后缀"A"，长度1
  next[3] = 2  "ABAB" → 前缀"AB" = 后缀"AB"，长度2
  next[4] = 3  "ABABA" → 前缀"ABA" = 后缀"ABA"，长度3
```

#### 匹配过程

当 `pattern[j]` 与 `text[i]` 失配时，不需要回退 `text` 的指针 `i`，而是让 `j = next[j-1]`，跳到模式串中已经匹配过的位置继续。

```
text:    A B A B A B C
pattern: A B A B D
                 ↑ j=4 失配

j 回退到 next[3] = 2，即 pattern[2] = 'A'
  text:    A B A B A B C
  pattern:       A B A B D
                  ↑ j=2 继续匹配
```

为什么可以跳过？因为 `next` 数组告诉我们：`pattern[0..j-1]` 的前 `next[j-1]` 个字符和后 `next[j-1]` 个字符相同，所以可以直接从 `next[j-1]` 的位置继续。

### Go 实现

```go
package main

import "fmt"

// BuildNext 构建 next 数组（最长相等前后缀长度）
// 时间: O(M)
func BuildNext(pattern string) []int {
	m := len(pattern)
	next := make([]int, m)
	next[0] = 0

	j := 0 // j 是当前最长相等前后缀的长度
	for i := 1; i < m; i++ {
		// 失配时回退 j
		for j > 0 && pattern[i] != pattern[j] {
			j = next[j-1]
		}
		if pattern[i] == pattern[j] {
			j++
		}
		next[i] = j
	}

	return next
}

// KMPSearch 在 text 中查找 pattern 的所有出现位置
// 时间: O(M + N)，空间: O(M)
func KMPSearch(text, pattern string) []int {
	if len(pattern) == 0 {
		return nil
	}

	next := BuildNext(pattern)
	var result []int
	j := 0 // 模式串指针

	for i := 0; i < len(text); i++ {
		// 失配时回退 j
		for j > 0 && text[i] != pattern[j] {
			j = next[j-1]
		}
		if text[i] == pattern[j] {
			j++
		}
		// 完全匹配
		if j == len(pattern) {
			result = append(result, i-len(pattern)+1)
			j = next[j-1] // 继续查找下一个匹配
		}
	}

	return result
}

func main() {
	text := "ABABABABCABABAB"
	pattern := "ABABA"

	next := BuildNext(pattern)
	fmt.Printf("pattern: %s\n", pattern)
	fmt.Printf("next: %v\n", next)

	positions := KMPSearch(text, pattern)
	fmt.Printf("匹配位置: %v\n", positions)
	// 匹配位置: [0 2 9]

	// 验证
	for _, pos := range positions {
		fmt.Printf("  text[%d..%d] = %s\n", pos, pos+len(pattern)-1, text[pos:pos+len(pattern)])
	}
}
```

> **要点总结：**
> - KMP 的核心是 next 数组，它利用模式串自身的重复结构避免重复匹配
> - next[i] = pattern[0..i] 的最长相等前后缀长度，构建过程本身也是一次 KMP 匹配
> - 时间复杂度 O(M+N)：text 指针不回退，pattern 指针最多回退 M 次
> - 变体：next 数组还可用于求字符串的最小循环节（周期 = n - next[n-1]）

---

## 17.8 滑动窗口

### 问题定义

滑动窗口是一种在数组/字符串上维护一个区间（窗口）的技术，窗口根据条件滑动（左边界或右边界移动），用于求解满足特定条件的连续子数组/子串问题。

### 原理分析

滑动窗口的核心是**双指针**：右指针扩展窗口，左指针收缩窗口。根据问题类型分为：

- **固定大小窗口**：窗口大小固定，右指针每次移动一步，左指针同步移动
- **可变大小窗口**：窗口大小根据条件动态调整

通用模板：

```
left = 0
for right = 0; right < n; right++ {
    // 将 right 指向的元素加入窗口
    window.add(nums[right])

    // 当窗口不满足条件时，收缩左边界
    while window 不满足条件 {
        window.remove(nums[left])
        left++
    }

    // 此时窗口满足条件，更新答案
    ans = update(ans)
}
```

关键点：**右指针扩展是主动的（for 循环），左指针收缩是被动的（while 循环）**。

### Go 实现

```go
package main

import "fmt"

// MinSubArrayLen 长度最小的子数组（和 ≥ target）
// LeetCode 209: 可变窗口，求最小长度
// 时间: O(N)，空间: O(1)
func MinSubArrayLen(target int, nums []int) int {
	n := len(nums)
	left, sum := 0, 0
	minLen := n + 1

	for right := 0; right < n; right++ {
		sum += nums[right]
		for sum >= target {
			if right-left+1 < minLen {
				minLen = right - left + 1
			}
			sum -= nums[left]
			left++
		}
	}

	if minLen == n+1 {
		return 0
	}
	return minLen
}

// LengthOfLongestSubstring 无重复字符的最长子串
// LeetCode 3: 可变窗口，求最大长度
// 时间: O(N)，空间: O(min(M, N))，M 为字符集大小
func LengthOfLongestSubstring(s string) int {
	charSet := make(map[byte]int) // 字符 → 最新索引
	left, maxLen := 0, 0

	for right := 0; right < len(s); right++ {
		if idx, ok := charSet[s[right]]; ok && idx >= left {
			// 字符重复，左边界跳到重复字符的下一个位置
			left = idx + 1
		}
		charSet[s[right]] = right
		if right-left+1 > maxLen {
			maxLen = right - left + 1
		}
	}

	return maxLen
}

// MaxSlidingWindow 滑动窗口最大值
// LeetCode 239: 固定窗口大小，使用单调队列
// 时间: O(N)，空间: O(K)
func MaxSlidingWindow(nums []int, k int) []int {
	if len(nums) == 0 || k == 0 {
		return nil
	}

	var result []int
	deque := []int{} // 存索引，维护单调递减

	for i := 0; i < len(nums); i++ {
		// 移除超出窗口的元素
		for len(deque) > 0 && deque[0] < i-k+1 {
			deque = deque[1:]
		}

		// 移除比当前元素小的（它们不可能成为最大值）
		for len(deque) > 0 && nums[deque[len(deque)-1]] < nums[i] {
			deque = deque[:len(deque)-1]
		}

		deque = append(deque, i)

		// 窗口形成后，队首就是最大值
		if i >= k-1 {
			result = append(result, nums[deque[0]])
		}
	}

	return result
}

// FindAnagrams 找到字符串中所有字母异位词的起始索引
// LeetCode 438: 固定窗口大小 + 字母计数
func FindAnagrams(s, p string) []int {
	if len(s) < len(p) {
		return nil
	}

	// 用数组代替 map，效率更高
	var pCount, sCount [26]int
	for i := 0; i < len(p); i++ {
		pCount[p[i]-'a']++
		sCount[s[i]-'a']++
	}

	var result []int
	if pCount == sCount {
		result = append(result, 0)
	}

	for i := len(p); i < len(s); i++ {
		// 窗口右移：加入新字符，移除旧字符
		sCount[s[i]-'a']++
		sCount[s[i-len(p)]-'a']--

		if pCount == sCount {
			result = append(result, i-len(p)+1)
		}
	}

	return result
}

func main() {
	// 最小子数组长度
	nums := []int{2, 3, 1, 2, 4, 3}
	fmt.Printf("最小子数组长度(≥7): %d\n", MinSubArrayLen(7, nums)) // 2

	// 无重复字符最长子串
	fmt.Printf("最长无重复子串: %d\n", LengthOfLongestSubstring("abcabcbb")) // 3

	// 滑动窗口最大值
	fmt.Printf("窗口最大值: %v\n", MaxSlidingWindow([]int{1, 3, -1, -3, 5, 3, 6, 7}, 3))
	// [3, 3, 5, 5, 6, 7]

	// 字母异位词
	fmt.Printf("异位词位置: %v\n", FindAnagrams("cbaebabacd", "abc")) // [0, 6]
}
```

> **要点总结：**
> - 滑动窗口适用于连续子数组/子串问题，核心是双指针 + 条件收缩
> - 固定窗口大小：右指针每次移动一步，左指针同步移动
> - 可变窗口大小：右指针主动扩展，左指针被动收缩
> - 窗口最大值问题需要配合单调队列，保证队首始终是当前窗口最大值
> - 字母异位词问题用数组计数比 map 更高效

---

## 17.9 Dijkstra 最短路径

### 问题定义

给定带权有向图和起点，求起点到所有其他顶点的最短路径。要求边权非负。

### 原理分析

Dijkstra 是**贪心算法**：每次选择当前距离最短的未访问顶点，用它的边去松弛（更新）邻居的距离。

为什么贪心是正确的？因为边权非负，所以已确定最短距离的顶点不会被后来发现的更短路径更新（更长的路径不可能产生更短的距离）。

```
松弛操作: if dist[u] + weight(u,v) < dist[v]:
              dist[v] = dist[u] + weight(u,v)

每次从优先队列取出 dist 最小的顶点 u，对 u 的所有邻居执行松弛。
```

#### 复杂度

- 使用优先队列（最小堆）：O((V+E)·logV)
- 使用数组（朴素）：O(V²)

Go 中可用 `container/heap` 实现优先队列。

### Go 实现

```go
package main

import (
	"container/heap"
	"fmt"
	"math"
)

// Edge 图的边
type Edge struct {
	To     int
	Weight int
}

// Graph 邻接表表示的有向图
type Graph struct {
	AdjList [][]Edge
	N       int
}

func NewGraph(n int) *Graph {
	return &Graph{
		AdjList: make([][]Edge, n),
		N:       n,
	}
}

func (g *Graph) AddEdge(from, to, weight int) {
	g.AdjList[from] = append(g.AdjList[from], Edge{To: to, Weight: weight})
}

// ========== 优先队列实现 ==========

type Item struct {
	Node int
	Dist int
}

type PriorityQueue []Item

func (pq PriorityQueue) Len() int           { return len(pq) }
func (pq PriorityQueue) Less(i, j int) bool { return pq[i].Dist < pq[j].Dist }
func (pq PriorityQueue) Swap(i, j int)      { pq[i], pq[j] = pq[j], pq[i] }

func (pq *PriorityQueue) Push(x interface{}) {
	*pq = append(*pq, x.(Item))
}

func (pq *PriorityQueue) Pop() interface{} {
	old := *pq
	n := len(old)
	x := old[n-1]
	*pq = old[:n-1]
	return x
}

// Dijkstra 求单源最短路径
// 时间: O((V+E)·logV)，空间: O(V+E)
func (g *Graph) Dijkstra(start int) ([]int, []int) {
	dist := make([]int, g.N)
	prev := make([]int, g.N) // 前驱节点，用于还原路径
	for i := range dist {
		dist[i] = math.MaxInt
		prev[i] = -1
	}
	dist[start] = 0

	pq := &PriorityQueue{{Node: start, Dist: 0}}
	heap.Init(pq)

	visited := make([]bool, g.N)

	for pq.Len() > 0 {
		cur := heap.Pop(pq).(Item)

		if visited[cur.Node] {
			continue
		}
		visited[cur.Node] = true

		for _, edge := range g.AdjList[cur.Node] {
			if dist[cur.Node]+edge.Weight < dist[edge.To] {
				dist[edge.To] = dist[cur.Node] + edge.Weight
				prev[edge.To] = cur.Node
				heap.Push(pq, Item{Node: edge.To, Dist: dist[edge.To]})
			}
		}
	}

	return dist, prev
}

// GetPath 从前驱数组还原路径
func GetPath(prev []int, target int) []int {
	path := []int{}
	for cur := target; cur != -1; cur = prev[cur] {
		path = append(path, cur)
	}
	// 反转
	for l, r := 0, len(path)-1; l < r; l, r = l+1, r-1 {
		path[l], path[r] = path[r], path[l]
	}
	return path
}

func main() {
	// 构建图
	//     0 →(2)→ 1 →(3)→ 3
	//     |        ↑        ↓
	//    (6)      (1)      (1)
	//     ↓        |        ↓
	//     2 →(4)→ 1    ←   4
	//     ↓
	//    (5)
	//     ↓
	//     3
	g := NewGraph(5)
	g.AddEdge(0, 1, 2)
	g.AddEdge(0, 2, 6)
	g.AddEdge(1, 3, 3)
	g.AddEdge(2, 1, 1)
	g.AddEdge(2, 3, 5)
	g.AddEdge(3, 4, 1)

	dist, prev := g.Dijkstra(0)

	fmt.Println("从顶点0出发的最短距离:")
	for i, d := range dist {
		if d == math.MaxInt {
			fmt.Printf("  到 %d: 不可达\n", i)
		} else {
			fmt.Printf("  到 %d: 距离=%d, 路径=%v\n", i, d, GetPath(prev, i))
		}
	}
	// 到 0: 距离=0, 路径=[0]
	// 到 1: 距离=2, 路径=[0, 1]
	// 到 2: 距离=6, 路径=[0, 2]
	// 到 3: 距离=5, 路径=[0, 1, 3]
	// 到 4: 距离=6, 路径=[0, 1, 3, 4]
}
```

> **要点总结：**
> - Dijkstra 要求边权非负，有负权边用 Bellman-Ford
> - 贪心策略正确的前提：已确定最短距离的顶点不会被更新
> - 优先队列中可能有同一顶点的多个距离值，用 `visited` 数组去重
> - 时间复杂度 O((V+E)·logV)，空间复杂度 O(V+E)

---

## 17.10 二分查找

### 问题定义

在**有序**序列中查找目标值，或查找满足某个条件的边界。时间复杂度 O(logN)。

### 原理分析

二分查找不仅仅是"在有序数组中找目标值"，更通用的理解是：**在一个单调的判定空间上，通过二分缩小搜索范围**。

关键在于识别问题的单调性：
- 找第一个 ≥ target 的位置 → 判定函数 `f(mid) = nums[mid] >= target`
- 找最后一个 < target 的位置 → 判定函数 `f(mid) = nums[mid] < target`

#### 两种模板

```
模板1：找第一个满足条件的位置（左边界）
  left = 0, right = n-1
  while left < right:
      mid = left + (right - left) / 2
      if 满足条件(mid):
          right = mid    // 答案在左半边（含mid）
      else:
          left = mid + 1 // 答案在右半边（不含mid）
  return left

模板2：找最后一个满足条件的位置（右边界）
  left = 0, right = n-1
  while left < right:
      mid = left + (right - left + 1) / 2  // 注意向上取整！
      if 满足条件(mid):
          left = mid     // 答案在右半边（含mid）
      else:
          right = mid - 1 // 答案在左半边（不含mid）
  return left
```

模板2中 `mid` 必须向上取整，否则当 `left = right - 1` 时，`mid = left`，如果满足条件会 `left = mid = left`，死循环。

### Go 实现

```go
package main

import "fmt"

// BinarySearch 标准二分查找，返回目标索引（不存在返回 -1）
func BinarySearch(nums []int, target int) int {
	left, right := 0, len(nums)-1
	for left <= right {
		mid := left + (right-left)/2
		if nums[mid] == target {
			return mid
		} else if nums[mid] < target {
			left = mid + 1
		} else {
			right = mid - 1
		}
	}
	return -1
}

// LowerBound 找第一个 ≥ target 的位置
// 如果所有元素都 < target，返回 len(nums)
func LowerBound(nums []int, target int) int {
	left, right := 0, len(nums)
	for left < right {
		mid := left + (right-left)/2
		if nums[mid] >= target {
			right = mid
		} else {
			left = mid + 1
		}
	}
	return left
}

// UpperBound 找第一个 > target 的位置
func UpperBound(nums []int, target int) int {
	left, right := 0, len(nums)
	for left < right {
		mid := left + (right-left)/2
		if nums[mid] > target {
			right = mid
		} else {
			left = mid + 1
		}
	}
	return left
}

// SearchRange 在排序数组中查找目标值的起始和结束位置
// LeetCode 34
func SearchRange(nums []int, target int) []int {
	if len(nums) == 0 {
		return []int{-1, -1}
	}

	// 找第一个 ≥ target 的位置
	left := LowerBound(nums, target)
	if left == len(nums) || nums[left] != target {
		return []int{-1, -1}
	}

	// 找第一个 > target 的位置，再 -1 就是最后一个 = target 的位置
	right := UpperBound(nums, target) - 1

	return []int{left, right}
}

// SearchRotatedArray 在旋转排序数组中查找目标值
// LeetCode 33
func SearchRotatedArray(nums []int, target int) int {
	left, right := 0, len(nums)-1

	for left <= right {
		mid := left + (right-left)/2
		if nums[mid] == target {
			return mid
		}

		// 判断哪半边是有序的
		if nums[left] <= nums[mid] {
			// 左半边有序
			if nums[left] <= target && target < nums[mid] {
				right = mid - 1
			} else {
				left = mid + 1
			}
		} else {
			// 右半边有序
			if nums[mid] < target && target <= nums[right] {
				left = mid + 1
			} else {
				right = mid - 1
			}
		}
	}

	return -1
}

// BinarySearchAnswer 二分答案（求满足条件的最小值）
// 示例：将数组分成最多 k 个子数组，使最大子数组和最小
func BinarySearchAnswer(nums []int, k int) int {
	// 答案范围：[max(nums), sum(nums)]
	lo, hi := 0, 0
	for _, n := range nums {
		if n > lo {
			lo = n
		}
		hi += n
	}

	// 判定函数：能否将数组分成 ≤k 个子数组，每个子数组和 ≤ mid
	canSplit := func(maxSum int) bool {
		count := 1
		current := 0
		for _, n := range nums {
			if current+n > maxSum {
				count++
				current = n
			} else {
				current += n
			}
		}
		return count <= k
	}

	// 二分找最小的满足条件的 maxSum
	for lo < hi {
		mid := lo + (hi-lo)/2
		if canSplit(mid) {
			hi = mid
		} else {
			lo = mid + 1
		}
	}

	return lo
}

func main() {
	nums := []int{1, 2, 3, 4, 5, 6, 7, 8, 9}

	// 标准查找
	fmt.Printf("查找 5: 索引=%d\n", BinarySearch(nums, 5))   // 4
	fmt.Printf("查找 10: 索引=%d\n", BinarySearch(nums, 10))  // -1

	// 边界查找
	fmt.Printf("第一个 ≥ 5: 索引=%d\n", LowerBound(nums, 5))  // 4
	fmt.Printf("第一个 > 5: 索引=%d\n", UpperBound(nums, 5))   // 5

	// 目标范围
	nums2 := []int{5, 7, 7, 8, 8, 10}
	fmt.Printf("8 的范围: %v\n", SearchRange(nums2, 8))  // [3, 4]
	fmt.Printf("6 的范围: %v\n", SearchRange(nums2, 6))  // [-1, -1]

	// 旋转数组查找
	rotated := []int{4, 5, 6, 7, 0, 1, 2}
	fmt.Printf("旋转数组查找 0: 索引=%d\n", SearchRotatedArray(rotated, 0)) // 4

	// 二分答案
	arr := []int{7, 2, 5, 10, 8}
	fmt.Printf("分成2组，最大组和最小值: %d\n", BinarySearchAnswer(arr, 2)) // 18
}
```

> **要点总结：**
> - 二分查找的本质是在单调判定空间上缩小搜索范围，不仅仅是"在有序数组中找值"
> - `LowerBound`（第一个 ≥）和 `UpperBound`（第一个 >）是最通用的两个模板
> - `mid = left + (right-left)/2` 防止整数溢出，且向下取整；右边界模板需要向上取整
> - 二分答案是一种重要的思维模式：将最优化问题转化为判定问题

---

## 章节总结

本章覆盖了 10 类经典算法的原理分析、图解推导与 Go 实现：

| 算法 | 核心思想 | 时间复杂度 | 关键技巧 |
|------|---------|-----------|---------|
| TopK（堆） | 小顶堆当筛子 | O(N·logK) | 堆顶是门槛 |
| TopK（快速选择） | 分治只递归一侧 | O(N) 平均 | 随机化 pivot |
| Manacher | 回文对称性复用 | O(N) | 预处理 + mirror |
| 动态规划 | 重叠子问题 + 最优子结构 | 因题而异 | 状态定义 + 转移方程 |
| 并查集 | 动态连通性 | O(α(N)) 均摊 | 路径压缩 + 按秩合并 |
| 单调栈 | 弹栈时处理答案 | O(N) | 递减栈求更大元素 |
| 前缀和与差分 | 预处理换查询效率 | O(N) 预处理 O(1) 查询 | 容斥原理 |
| KMP | 利用模式串自身重复 | O(M+N) | next 数组 |
| 滑动窗口 | 双指针 + 条件收缩 | O(N) | 右扩左缩 |
| Dijkstra | 贪心选最短 + 松弛 | O((V+E)·logV) | 优先队列 |
| 二分查找 | 单调空间上缩小范围 | O(logN) | LowerBound/UpperBound |