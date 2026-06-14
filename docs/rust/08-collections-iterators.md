# 第8章 集合与迭代器

> 本章面向已掌握 Rust 基础语法与所有权概念的开发者。你将深入学习 Rust 标准库中的常用集合类型、迭代器模式及适配器链的用法，掌握如何在不同场景下选择最合适的数据结构。

---

## 8.1 Vec 与 VecDeque

### 8.1.1 Vec`<T>` — 动态数组

`Vec<T>` 是 Rust 中最常用的**堆分配的可变长度数组**，提供了连续的内存存储和 O(1) 的索引访问。

```rust
let mut v: Vec<i32> = Vec::new();
v.push(1);
v.push(2);
v.push(3);

// 使用宏创建
let v2 = vec![1, 2, 3];

// 索引访问
let third = &v2[2]; // 越界会 panic
let third = v2.get(2); // 返回 Option<&T>
```

**容量与内存管理：**

```rust
let mut v = Vec::with_capacity(100); // 预分配容量
println!("len: {}, cap: {}", v.len(), v.capacity()); // len: 0, cap: 100

// 扩容策略：每次容量翻倍
for i in 0..1000 {
    v.push(i);
}
println!("cap after 1000 pushes: {}", v.capacity()); // 通常是 1024

// 收缩到实际大小
v.shrink_to_fit();
println!("shrink_to_fit cap: {}", v.capacity()); // 1000
```

**常用方法速查：**

| 方法 | 说明 | 复杂度 |
|------|------|--------|
| `push(val)` | 末尾添加元素 | 均摊 O(1) |
| `pop()` | 末尾移除元素 | O(1) |
| `insert(idx, val)` | 指定位置插入 | O(n) |
| `remove(idx)` | 指定位置移除 | O(n) |
| `retain(f)` | 保留满足条件的元素 | O(n) |
| `dedup()` | 移除连续重复元素 | O(n) |
| `extend(iter)` | 追加迭代器内容 | O(k) |
| `truncate(len)` | 截断到指定长度 | O(n) |
| `resize(len, val)` | 调整大小并填充 | O(n) |
| `split_off(idx)` | 从 idx 处切分 | O(n) |

> 💡 **提示**：`Vec` 在 push 过多导致扩容时可能触发重新分配，旧的引用会失效。避免在持有引用的同时 push。

### 8.1.2 VecDeque`<T>` — 双端队列

`VecDeque<T>` 在 `std::collections` 中，支持**两端高效插入和删除**，适用于 FIFO 或双端操作场景。

```rust
use std::collections::VecDeque;

let mut deq = VecDeque::new();
deq.push_back(1);
deq.push_front(0);
deq.push_back(2);

assert_eq!(deq.pop_front(), Some(0));
assert_eq!(deq.pop_back(), Some(2));
```

**底层实现：** VecDeque 使用环形缓冲区（ring buffer），在两端操作时**无需移动元素**，因此 `push_front` 和 `pop_front` 都是 O(1) 的。

```rust
use std::collections::VecDeque;

// 固定容量的双端队列——用作环形缓冲区
let mut buf = VecDeque::with_capacity(4);
buf.push_back(1);
buf.push_back(2);
buf.push_back(3);
buf.push_back(4);

// 容量满后继续 push_back 不会自动扩容
// 但可以手动管理：pop_front 腾出空间
buf.pop_front();
buf.push_back(5); // 此时 [2, 3, 4, 5]
```

**Vec vs VecDeque 选择指南：**

| 特性 | Vec | VecDeque |
|------|-----|----------|
| 前端插入/删除 | O(n) — 不推荐 | O(1) |
| 后端插入/删除 | 均摊 O(1) | O(1) |
| 索引访问 | O(1) | O(1) |
| 内存连续性 | 完全连续 | 环形缓冲，逻辑连续 |
| 适用场景 | 栈、泛型集合、需要切片 | 队列、双端缓冲 |

> 💡 **提示**：如果你只需要尾部操作，用 `Vec`；如果需要头部操作（FIFO 队列），用 `VecDeque`。`VecDeque` 可以作为 `Vec` 的替代来避免前端 O(n) 的开销。

---

## 8.2 HashMap 与 BTreeMap

### 8.2.1 HashMap`<K, V>` — 哈希表

`HashMap` 基于**哈希函数**实现键值映射，平均场景下提供 O(1) 的插入、查找和删除。默认使用 SipHash（抗 HashDos 攻击）。

```rust
use std::collections::HashMap;

let mut scores = HashMap::new();
scores.insert(String::from("Alice"), 95);
scores.insert(String::from("Bob"), 87);

// 读取
let alice_score = scores.get("Alice"); // Some(&95)
let missing = scores.get("Charlie"); // None

// 遍历
for (name, score) in &scores {
    println!("{name}: {score}");
}
```

**Entry API — 优雅地处理存在/不存在：**

```rust
use std::collections::HashMap;

let mut map = HashMap::new();

// or_insert：如果 key 不存在则插入
map.entry("count").or_insert(0);
*map.get_mut("count").unwrap() += 1;

// or_insert_with：惰性初始化
map.entry("expensive")
    .or_insert_with(|| compute_value());

// and_modify：链式修改
map.entry("count")
    .and_modify(|c| *c += 1)
    .or_insert(1);

fn compute_value() -> i32 {
    // 模拟耗时计算
    42
}
```

**自定义哈希器：** 你可以通过 `std::collections::HashMap::with_hasher` 使用更快的哈希器（如 `fxhash` 或 `ahash`）。

```rust
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

// 极简的哈希器示例（仅用于教学，生产环境请用 ahash）
pub struct IdentityHasher(u64);

impl Hasher for IdentityHasher {
    fn finish(&self) -> u64 { self.0 }
    fn write(&mut self, bytes: &[u8]) {
        for &b in bytes {
            self.0 = self.0.wrapping_mul(31).wrapping_add(b as u64);
        }
    }
}

type FastMap<K, V> = HashMap<K, V, BuildHasherDefault<IdentityHasher>>;
```

> 💡 **提示**：如果你需要 SQL 风格的 `get_or_insert_with` 逻辑，`HashMap` 的 `entry` API 是首选方案。高频场景下考虑切换到 `ahash` 或 `rustc_hash`。

### 8.2.2 BTreeMap`<K, V>` — 有序映射

`BTreeMap` 基于 **B 树**（实际是 B+ 树变体）实现，键按**有序性**存储，查找、插入、删除均为 O(log n)。

```rust
use std::collections::BTreeMap;

let mut map = BTreeMap::new();
map.insert("c", 3);
map.insert("a", 1);
map.insert("b", 2);

// 自动按 key 排序遍历
for (k, v) in &map {
    println!("{k}: {v}"); // a: 1, b: 2, c: 3
}

// 范围查询
let mut range = map.range("a".."c"); // ["a", "c")
for (k, v) in &mut range {
    println!("{k}: {v}"); // a, b
}

// 获取前驱/后继
assert_eq!(map.first_entry().unwrap().key(), &"a");
assert_eq!(map.last_entry().unwrap().key(), &"c");
```

### 8.2.3 性能对比与选择

| 特性 | HashMap | BTreeMap |
|------|---------|----------|
| 平均查询 | O(1) | O(log n) |
| 最坏查询 | O(n)（哈希碰撞） | O(log n) |
| 键要求 | `Hash + Eq` | `Ord` |
| 内存占用 | 较高（负载因子约 0.7-0.9） | 较低 |
| 有序遍历 | ❌ 无序 | ✅ 升序 |
| 范围查询 | ❌ | ✅ `range()` |
| 前缀查询 | ❌ | ✅（字符串可模拟） |

**选择指南：**

- **无需顺序、查询为主** → `HashMap`
- **需要有序遍历/范围查询** → `BTreeMap`
- **键类型不支持 Hash 但支持 Ord** → `BTreeMap`
- **需要确定性的性能**（避免哈希攻击） → `BTreeMap`

---

## 8.3 HashSet 与 BTreeSet

### 8.3.1 HashSet`<T>`

`HashSet<T>` 本质上是 `HashMap<T, ()>` 的包装，用于**快速成员检查**和**集合运算**。

```rust
use std::collections::HashSet;

let mut set = HashSet::new();
set.insert(1);
set.insert(2);
set.insert(3);

assert!(set.contains(&2));
assert!(!set.contains(&5));
```

**集合运算：**

```rust
use std::collections::HashSet;

let a: HashSet<_> = [1, 2, 3, 4].into_iter().collect();
let b: HashSet<_> = [3, 4, 5, 6].into_iter().collect();

// 并集
let union: HashSet<_> = a.union(&b).copied().collect();
assert_eq!(union, [1, 2, 3, 4, 5, 6].into_iter().collect());

// 交集
let intersection: HashSet<_> = a.intersection(&b).copied().collect();
assert_eq!(intersection, [3, 4].into_iter().collect());

// 差集（在 a 中但不在 b 中）
let diff: HashSet<_> = a.difference(&b).copied().collect();
assert_eq!(diff, [1, 2].into_iter().collect());

// 对称差集（a ∪ b - a ∩ b）
let sym_diff: HashSet<_> = a.symmetric_difference(&b).copied().collect();
assert_eq!(sym_diff, [1, 2, 5, 6].into_iter().collect());
```

### 8.3.2 BTreeSet`<T>`

`BTreeSet<T>` 是 `BTreeMap<T, ()>` 的包装，元素有序存储。

```rust
use std::collections::BTreeSet;

let mut set = BTreeSet::new();
set.insert(5);
set.insert(1);
set.insert(3);

// 自动排序
for v in &set {
    print!("{v} "); // 1 3 5
}

// 范围查询
let range: Vec<_> = set.range(2..=4).copied().collect();
assert_eq!(range, vec![3]);
```

| 特性 | HashSet | BTreeSet |
|------|---------|----------|
| 查询 | O(1) 平均 | O(log n) |
| 有序遍历 | ❌ | ✅ |
| 范围查询 | ❌ | ✅ |
| 集合运算 | ✅ 全套 | ✅ 全套 |

> 💡 **提示**：集合运算时，`BTreeSet` 的 `intersection`/`union` 可以利用有序性更早剪枝，在大数据集上某些场景比 `HashSet` 更快。

### 8.3.3 自定义类型作为集合元素

```rust
use std::cmp::Ordering;
use std::collections::HashSet;
use std::hash::{Hash, Hasher};

#[derive(Debug)]
struct Person {
    id: u32,
    name: String,
}

// 自定义 Hash + Eq
impl Hash for Person {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.id.hash(state);
    }
}

impl PartialEq for Person {
    fn eq(&self, other: &Self) -> bool {
        self.id == other.id
    }
}

impl Eq for Person {}

// 如果要放入 BTreeSet
impl Ord for Person {
    fn cmp(&self, other: &Self) -> Ordering {
        self.id.cmp(&other.id)
    }
}

impl PartialOrd for Person {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

let mut set = HashSet::new();
set.insert(Person { id: 1, name: "Alice".into() });
set.insert(Person { id: 2, name: "Bob".into() });
```

---

## 8.4 迭代器与适配器

### 8.4.1 Iterator Trait

Rust 的迭代器是**惰性的**，通过实现 `Iterator` trait 来驱动。

```rust
pub trait Iterator {
    type Item;

    fn next(&mut self) -> Option<Self::Item>;

    // 默认方法提供丰富的适配器...
    fn map<B, F>(self, f: F) -> Map<Self, F> where ...
    fn filter<P>(self, predicate: P) -> Filter<Self, P> where ...
    // ... 几十个内置方法
}
```

### 8.4.2 IntoIterator 与 for 循环

`for` 循环是 `IntoIterator` 的语法糖：

```rust
let v = vec![1, 2, 3];

// 等价于：
for x in v {}            // v.into_iter() — 消费所有权
for x in &v {}           // (&v).into_iter() — 不可变借用
for x in &mut v {}       // (&mut v).into_iter() — 可变借用
```

### 8.4.3 常用适配器链

```rust
let numbers = vec![1, 2, 3, 4, 5, 6];

// map + filter + collect
let result: Vec<_> = numbers
    .iter()
    .filter(|&&x| x % 2 == 0)
    .map(|x| x * 2)
    .collect();
assert_eq!(result, vec![4, 8, 12]);

// flat_map：展平嵌套
let nested = vec![vec![1, 2], vec![3, 4], vec![5, 6]];
let flat: Vec<_> = nested.iter().flatten().copied().collect();
assert_eq!(flat, vec![1, 2, 3, 4, 5, 6]);

// filter_map：过滤 + 映射合一
let strs = vec!["1", "abc", "42", "xyz"];
let nums: Vec<i32> = strs
    .iter()
    .filter_map(|s| s.parse::<i32>().ok())
    .collect();
assert_eq!(nums, vec![1, 42]);

// take_while / skip_while
let data = vec![1, 2, 3, 4, 5, 0, 6];
let taken: Vec<_> = data.into_iter().take_while(|&x| x != 0).collect();
assert_eq!(taken, vec![1, 2, 3, 4, 5]);
```

### 8.4.4 消费适配器

| 方法 | 作用 | 返回值 |
|------|------|--------|
| `collect()` | 收集到集合 | `FromIterator` 类型 |
| `fold(init, f)` | 折叠/归约 | 单值 |
| `reduce(f)` | 归约（非空） | `Option<T>` |
| `sum()` | 求和 | `T: Sum` |
| `product()` | 求积 | `T: Product` |
| `count()` | 计数 | `usize` |
| `any(f)` | 是否存在一个 | `bool` |
| `all(f)` | 是否所有 | `bool` |
| `find(f)` | 查找第一个 | `Option<T>` |
| `partition(f)` | 分两组 | `(Vec, Vec)` |

```rust
let nums = [1, 2, 3, 4, 5];

// fold：手动累加
let sum = nums.iter().fold(0, |acc, x| acc + x);
assert_eq!(sum, 15);

// 链式调用统计
let (even, odd): (Vec<_>, Vec<_>) = nums.iter().partition(|&&x| x % 2 == 0);
assert_eq!(even, vec![&2, &4]);
assert_eq!(odd, vec![&1, &3, &5]);

// 短路求值
let has_negative = nums.iter().any(|&x| x < 0);
assert!(!has_negative);
```

### 8.4.5 迭代器性能要点

1. **零成本抽象**：迭代器适配器链在编译后等价于手写循环
2. **融合优化**（FusedIterator）：一旦返回 `None`，后续 `next()` 也返回 `None`
3. **内联友好**：闭包被内联后迭代器组合的开销消失

```rust
// 手写循环 vs 迭代器 — 编译器生成相同机器码
let v = vec![1, 2, 3, 4, 5];

// 手写
let mut sum1 = 0;
for x in &v {
    sum1 += x * 2;
}

// 迭代器
let sum2: i32 = v.iter().map(|x| x * 2).sum();
assert_eq!(sum1, sum2);
```

> 💡 **提示**：推荐优先使用迭代器链式调用，代码更声明式、可读性更好。性能测试表明编译器能完全消除抽象开销。

---

## 8.5 自定义迭代器

### 8.5.1 实现 Iterator

```rust
struct Fibonacci {
    curr: u64,
    next: u64,
}

impl Fibonacci {
    fn new() -> Self {
        Fibonacci { curr: 0, next: 1 }
    }
}

impl Iterator for Fibonacci {
    type Item = u64;

    fn next(&mut self) -> Option<Self::Item> {
        let current = self.curr;

        // 防止溢出
        if let Some(new_next) = self.curr.checked_add(self.next) {
            self.curr = self.next;
            self.next = new_next;
            Some(current)
        } else {
            None
        }
    }
}

// 使用
let fib: Vec<_> = Fibonacci::new().take(10).collect();
assert_eq!(fib, vec![0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
```

### 8.5.2 实现 IntoIterator

```rust
#[derive(Debug)]
struct Range<T> {
    start: T,
    end: T,
}

struct RangeIter<T> {
    current: T,
    end: T,
}

impl<T: Copy + PartialOrd + Add<Output = T> + One> IntoIterator for Range<T> {
    type Item = T;
    type IntoIter = RangeIter<T>;

    fn into_iter(self) -> Self::IntoIter {
        RangeIter {
            current: self.start,
            end: self.end,
        }
    }
}

// 简化版：仅支持 i32
impl IntoIterator for Range<i32> {
    type Item = i32;
    type IntoIter = RangeIter<i32>;

    fn into_iter(self) -> Self::IntoIter {
        RangeIter { current: self.start, end: self.end }
    }
}

impl Iterator for RangeIter<i32> {
    type Item = i32;

    fn next(&mut self) -> Option<Self::Item> {
        if self.current < self.end {
            let val = self.current;
            self.current += 1;
            Some(val)
        } else {
            None
        }
    }
}
```

### 8.5.3 适配器模式：自定义 IteratorAdapter

```rust
use std::iter::Fuse;

struct Alternating<I, J> {
    a: Fuse<I>,
    b: Fuse<J>,
    turn_a: bool,
}

impl<I, J> Alternating<I, J>
where
    I: Iterator,
    J: Iterator<Item = I::Item>,
{
    fn new(a: I, b: J) -> Self {
        Alternating {
            a: a.fuse(),
            b: b.fuse(),
            turn_a: true,
        }
    }
}

impl<I, J> Iterator for Alternating<I, J>
where
    I: Iterator,
    J: Iterator<Item = I::Item>,
{
    type Item = I::Item;

    fn next(&mut self) -> Option<Self::Item> {
        if self.turn_a {
            self.a.next().or_else(|| self.b.next())
        } else {
            self.b.next().or_else(|| self.a.next())
        }
        .map(|item| {
            self.turn_a = !self.turn_a;
            item
        })
    }
}
```

> 💡 **提示**：实现自定义迭代器时，通常还需要实现 `FusedIterator`、`ExactSizeIterator` 或 `DoubleEndedIterator` 来提供更多优化信息给编译器。

---

## 8.6 性能对比与选择指南

### 集合类型选择矩阵

| 需求 | 首选 | 备选 |
|------|------|------|
| 动态数组，尾部操作 | `Vec` | — |
| FIFO 队列 | `VecDeque` | `LinkedList`（很少用） |
| 无序 KV 存储 | `HashMap` | — |
| 有序 KV 存储 | `BTreeMap` | — |
| 无序集合 | `HashSet` | — |
| 有序集合 | `BTreeSet` | — |
| 小集合（<10 个元素） | 直接数组 + 线性搜索 | — |
| 字符串连接 | `String` | `Vec<char>` |
| 优先级队列 | `BinaryHeap` | — |

### 常见陷阱

```rust
// 陷阱1：在持有引用时修改 Vec
let mut v = vec![1, 2, 3];
let first = &v[0];
// v.push(4); // ❌ 编译错误：可变借用与不可变借用同时存在
drop(first);
v.push(4); // ✅

// 陷阱2：HashMap 的 entry API 避免两次查找
// ❌ 低效：contains_key 后再 insert 导致两次查找
if !map.contains_key(&key) {
    map.insert(key.clone(), value);
}

// ✅ 高效：entry API 一次查找
map.entry(key).or_insert(value);

// 陷阱3：Vec 的 retain 性能陷阱（大量元素时）
// retain 在删除元素时会逐位移动，大量删除时可能较慢
// 可以用 drain_filter (unstable) 或 swap_remove
```

### 微基准测试经验法则

- **小数据集**（<100 项）：线性搜索 vs 哈希表差异可忽略，`Vec` 更友好
- **中数据集**（100-10k）：`HashMap`/`BTreeMap` 优势开始显现
- **大数据集**（>100k）：`HashMap` 哈希优势明显，但要注意内存占用
- **字符串键**：`BTreeMap` 的字符串比较可能比哈希计算更便宜（短字符串）
- **整数键**：`HashMap` 通常更快（整数哈希计算简单）

> 💡 **提示**：在选择前先用 `#[bench]` 或 `criterion` 做基准测试。**不要过早优化** — 先用语义最清晰的数据结构，有性能瓶颈再替换。

### 扩展阅读

- `std::collections` 官方文档：所有集合的完整 API
- `smallvec` crate：栈上分配的小型动态数组
- `im` crate：不可变持久化数据结构
- `dashmap` crate：高并发 HashMap
- `slotmap` crate：稳定的句柄式存储

---

**本章总结：**

| 主题 | 关键要点 |
|------|----------|
| Vec / VecDeque | 尾部用 Vec，双端用 VecDeque |
| HashMap / BTreeMap | 无序用 HashMap，有序用 BTreeMap |
| HashSet / BTreeSet | 同上，集合运算时注意大小 |
| 迭代器链 | 零成本抽象，优先链式调用 |
| 自定义迭代器 | 实现 Iterator trait，注意辅助 trait |
| 性能选择 | 语义优先，验证瓶颈再优化 |
