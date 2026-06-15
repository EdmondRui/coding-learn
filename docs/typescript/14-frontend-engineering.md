# 第 14 章：前端工程化与 React 类型实践

> 目标读者：有 TypeScript 基础，希望在前端项目中系统运用类型系统的开发者。本章涵盖 React 类型实践、状态管理类型安全、组件设计模式、测试策略和构建优化。

---

## 14.1 React 组件类型

### 14.1.1 函数组件与 Props

```typescript
// 基础函数组件
type UserCardProps = {
  name: string;
  email: string;
  avatar?: string;
  role: "admin" | "user" | "viewer";
};

function UserCard({ name, email, avatar, role }: UserCardProps) {
  return (
    <div className="user-card">
      {avatar && <img src={avatar} alt={name} />}
      <h3>{name}</h3>
      <p>{email}</p>
      <span className="badge">{role}</span>
    </div>
  );
}
```

### 14.1.2 泛型组件

```typescript
// 泛型列表组件
type ListProps<T> = {
  items: T[];
  keyFn: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
  emptyMessage?: string;
};

function List<T>({ items, keyFn, renderItem, emptyMessage = "暂无数据" }: ListProps<T>) {
  if (items.length === 0) {
    return <p className="empty">{emptyMessage}</p>;
  }

  return (
    <ul className="list">
      {items.map((item) => (
        <li key={keyFn(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  );
}

// 使用——类型自动推断
<List
  items={users}
  keyFn={(user) => user.id}
  renderItem={(user) => <span>{user.name}</span>}
/>;
```

### 14.1.3 组件组合模式

```typescript
// Compound Components（组合组件）
type TabsProps = {
  children: React.ReactNode;
  defaultIndex?: number;
  onChange?: (index: number) => void;
};

type TabProps = {
  label: string;
  children: React.ReactNode;
};

const TabsContext = React.createContext<{
  activeIndex: number;
  setActiveIndex: (index: number) => void;
}>({ activeIndex: 0, setActiveIndex: () => {} });

function Tabs({ children, defaultIndex = 0, onChange }: TabsProps) {
  const [activeIndex, setActiveIndex] = React.useState(defaultIndex);

  const contextValue = React.useMemo(
    () => ({
      activeIndex,
      setActiveIndex: (index: number) => {
        setActiveIndex(index);
        onChange?.(index);
      },
    }),
    [activeIndex, onChange]
  );

  return (
    <TabsContext.Provider value={contextValue}>
      <div className="tabs">{children}</div>
    </TabsContext.Provider>
  );
}

function TabList({ children }: { children: React.ReactNode }) {
  const { activeIndex, setActiveIndex } = React.useContext(TabsContext);
  const tabs = React.Children.toArray(children);

  return (
    <div className="tab-list" role="tablist">
      {tabs.map((tab, index) => (
        <button
          key={index}
          role="tab"
          aria-selected={activeIndex === index}
          className={activeIndex === index ? "active" : ""}
          onClick={() => setActiveIndex(index)}
        >
          {(tab as React.ReactElement<TabProps>).props.label}
        </button>
      ))}
    </div>
  );
}

function TabPanels({ children }: { children: React.ReactNode }) {
  const { activeIndex } = React.useContext(TabsContext);
  const panels = React.Children.toArray(children);

  return (
    <div className="tab-panels">
      {panels[activeIndex] ?? null}
    </div>
  );
}

function Tab({ children }: TabProps) {
  return <div role="tabpanel">{children}</div>;
}

// 使用
<Tabs defaultIndex={0} onChange={(i) => console.log(`Tab ${i}`)}>
  <TabList>
    <Tab label="概览">概览内容</Tab>
    <Tab label="设置">设置内容</Tab>
  </TabList>
  <TabPanels>
    <Tab label="概览">概览面板</Tab>
    <Tab label="设置">设置面板</Tab>
  </TabPanels>
</Tabs>
```

### 14.1.4 Render Props 与 Children 模式

```typescript
// Render Props 模式
type DataFetcherProps<T> = {
  url: string;
  children: (data: { result: T | null; loading: boolean; error: Error | null }) => React.ReactNode;
};

function DataFetcher<T>(props: DataFetcherProps<T>) {
  const [result, setResult] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<Error | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch(props.url)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setResult(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [props.url]);

  return <>{props.children({ result, loading, error })}</>;
}

// 使用
<DataFetcher<User[]> url="/api/users">
  {({ result, loading, error }) => {
    if (loading) return <Spinner />;
    if (error) return <ErrorDisplay error={error} />;
    return <UserList users={result!} />;
  }}
</DataFetcher>
```

---

## 14.2 Hooks 类型实践

### 14.2.1 自定义 Hook 类型

```typescript
// useLocalStorage——类型安全的本地存储
function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const [storedValue, setStoredValue] = React.useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = React.useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const newValue = value instanceof Function ? value(prev) : value;
        window.localStorage.setItem(key, JSON.stringify(newValue));
        return newValue;
      });
    },
    [key]
  );

  const removeValue = React.useCallback(() => {
    window.localStorage.removeItem(key);
    setStoredValue(initialValue);
  }, [key, initialValue]);

  return [storedValue, setValue, removeValue];
}

// 使用
const [theme, setTheme, resetTheme] = useLocalStorage<"light" | "dark">("theme", "light");
```

### 14.2.2 useAsync——异步状态管理

```typescript
type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: Error | null;
};

type AsyncActions<T> = {
  execute: (...args: any[]) => Promise<T>;
  reset: () => void;
};

function useAsync<T, A extends any[] = []>(
  asyncFn: (...args: A) => Promise<T>,
  immediate = false
): AsyncState<T> & AsyncActions<T> {
  const [state, setState] = React.useState<AsyncState<T>>({
    data: null,
    loading: immediate,
    error: null,
  });

  const execute = React.useCallback(
    async (...args: A): Promise<T> => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await asyncFn(...args);
        setState({ data, loading: false, error: null });
        return data;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        setState((prev) => ({ ...prev, loading: false, error: err }));
        throw err;
      }
    },
    [asyncFn]
  );

  const reset = React.useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return { ...state, execute, reset };
}

// 使用
function UserProfile({ userId }: { userId: string }) {
  const { data: user, loading, error, execute } = useAsync(
    (id: string) => fetchUser(id)
  );

  React.useEffect(() => {
    execute(userId);
  }, [userId, execute]);

  if (loading) return <Spinner />;
  if (error) return <ErrorDisplay error={error} />;
  if (!user) return null;
  return <UserCard user={user} />;
}
```

### 14.2.3 useReducer 类型安全

```typescript
// 类型安全的 Reducer
type Todo = {
  id: string;
  text: string;
  completed: boolean;
  createdAt: number;
};

type TodoAction =
  | { type: "ADD"; text: string }
  | { type: "TOGGLE"; id: string }
  | { type: "DELETE"; id: string }
  | { type: "EDIT"; id: string; text: string }
  | { type: "CLEAR_COMPLETED" };

function todoReducer(state: Todo[], action: TodoAction): Todo[] {
  switch (action.type) {
    case "ADD":
      return [
        ...state,
        {
          id: crypto.randomUUID(),
          text: action.text,
          completed: false,
          createdAt: Date.now(),
        },
      ];
    case "TOGGLE":
      return state.map((todo) =>
        todo.id === action.id ? { ...todo, completed: !todo.completed } : todo
      );
    case "DELETE":
      return state.filter((todo) => todo.id !== action.id);
    case "EDIT":
      return state.map((todo) =>
        todo.id === action.id ? { ...todo, text: action.text } : todo
      );
    case "CLEAR_COMPLETED":
      return state.filter((todo) => !todo.completed);
  }
}

function TodoApp() {
  const [todos, dispatch] = React.useReducer(todoReducer, []);

  // dispatch 类型安全——只能传入合法的 action
  const addTodo = (text: string) => dispatch({ type: "ADD", text });
  const toggleTodo = (id: string) => dispatch({ type: "TOGGLE", id });
  const deleteTodo = (id: string) => dispatch({ type: "DELETE", id });

  // dispatch({ type: "UNKNOWN" }); // ❌ 类型错误
  // dispatch({ type: "ADD" });     // ❌ 缺少 text

  return (
    <div>
      {todos.map((todo) => (
        <TodoItem
          key={todo.id}
          todo={todo}
          onToggle={() => toggleTodo(todo.id)}
          onDelete={() => deleteTodo(todo.id)}
        />
      ))}
    </div>
  );
}
```

---

## 14.3 状态管理类型安全

### 14.3.1 Zustand 类型安全 Store

```typescript
import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

// 定义 Store 类型
type UserState = {
  user: { id: string; name: string; email: string; role: string } | null;
  token: string | null;
  isAuthenticated: boolean;
};

type UserActions = {
  login: (user: UserState["user"], token: string) => void;
  logout: () => void;
  updateUser: (updates: Partial<NonNullable<UserState["user"]>>) => void;
};

type UserStore = UserState & UserActions;

const useUserStore = create<UserStore>()(
  devtools(
    persist(
      (set) => ({
        // 状态
        user: null,
        token: null,
        isAuthenticated: false,

        // 操作
        login: (user, token) =>
          set({ user, token, isAuthenticated: true }, false, "login"),

        logout: () =>
          set({ user: null, token: null, isAuthenticated: false }, false, "logout"),

        updateUser: (updates) =>
          set(
            (state) => ({
              user: state.user ? { ...state.user, ...updates } : null,
            }),
            false,
            "updateUser"
          ),
      }),
      { name: "user-store" } // localStorage key
    )
  )
);

// 使用——类型自动推断
function Header() {
  const user = useUserStore((s) => s.user);
  const logout = useUserStore((s) => s.logout);

  return (
    <header>
      {user ? (
        <>
          <span>{user.name}</span>
          <button onClick={logout}>退出</button>
        </>
      ) : (
        <a href="/login">登录</a>
      )}
    </header>
  );
}
```

### 14.3.2 类型安全的 Selector

```typescript
import { create } from "zustand";

type CartItem = {
  productId: string;
  name: string;
  price: number;
  quantity: number;
};

type CartStore = {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
};

const useCartStore = create<CartStore>((set) => ({
  items: [],

  addItem: (item) =>
    set((state) => {
      const existing = state.items.find((i) => i.productId === item.productId);
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.productId === item.productId
              ? { ...i, quantity: i.quantity + 1 }
              : i
          ),
        };
      }
      return { items: [...state.items, { ...item, quantity: 1 }] };
    }),

  removeItem: (productId) =>
    set((state) => ({
      items: state.items.filter((i) => i.productId !== productId),
    })),

  updateQuantity: (productId, quantity) =>
    set((state) => ({
      items: state.items.map((i) =>
        i.productId === productId ? { ...i, quantity } : i
      ),
    })),

  clearCart: () => set({ items: [] }),
}));

// 派生 selector
function useCartTotal() {
  return useCartStore((state) =>
    state.items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  );
}

function useCartCount() {
  return useCartStore((state) =>
    state.items.reduce((sum, item) => sum + item.quantity, 0)
  );
}
```

---

## 14.4 表单处理与验证

### 14.4.1 React Hook Form + Zod

```typescript
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

// Zod Schema——同时用于验证和类型推导
const registrationSchema = z
  .object({
    username: z
      .string()
      .min(3, "用户名至少 3 个字符")
      .max(20, "用户名最多 20 个字符")
      .regex(/^[a-zA-Z0-9_]+$/, "只允许字母、数字和下划线"),
    email: z.string().email("请输入有效的邮箱地址"),
    password: z
      .string()
      .min(8, "密码至少 8 个字符")
      .regex(/[A-Z]/, "密码需要包含大写字母")
      .regex(/[0-9]/, "密码需要包含数字"),
    confirmPassword: z.string(),
    role: z.enum(["developer", "designer", "manager"]),
    bio: z.string().max(500, "简介最多 500 字").optional(),
    agreeToTerms: z.literal(true, {
      errorMap: () => ({ message: "请同意服务条款" }),
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "两次密码不一致",
    path: ["confirmPassword"],
  });

// 从 Schema 推导类型
type RegistrationForm = z.infer<typeof registrationSchema>;

function RegistrationForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegistrationForm>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      role: "developer",
    },
  });

  const onSubmit = async (data: RegistrationForm) => {
    // data 类型完全安全
    const { confirmPassword, agreeToTerms, ...payload } = data;
    await api.post("/register", payload);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <div>
        <label>用户名</label>
        <input {...register("username")} />
        {errors.username && <span className="error">{errors.username.message}</span>}
      </div>

      <div>
        <label>邮箱</label>
        <input {...register("email")} type="email" />
        {errors.email && <span className="error">{errors.email.message}</span>}
      </div>

      <div>
        <label>密码</label>
        <input {...register("password")} type="password" />
        {errors.password && <span className="error">{errors.password.message}</span>}
      </div>

      <div>
        <label>确认密码</label>
        <input {...register("confirmPassword")} type="password" />
        {errors.confirmPassword && (
          <span className="error">{errors.confirmPassword.message}</span>
        )}
      </div>

      <div>
        <label>角色</label>
        <select {...register("role")}>
          <option value="developer">开发者</option>
          <option value="designer">设计师</option>
          <option value="manager">管理者</option>
        </select>
      </div>

      <div>
        <label>
          <input type="checkbox" {...register("agreeToTerms")} />
          我同意服务条款
        </label>
        {errors.agreeToTerms && (
          <span className="error">{errors.agreeToTerms.message}</span>
        )}
      </div>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "提交中..." : "注册"}
      </button>
    </form>
  );
}
```

### 14.4.2 动态表单

```typescript
// 动态字段列表
const itemSchema = z.object({
  name: z.string().min(1, "请输入名称"),
  quantity: z.coerce.number().min(1, "数量至少为 1"),
  price: z.coerce.number().min(0, "价格不能为负"),
});

const orderSchema = z.object({
  customerName: z.string().min(1, "请输入客户名称"),
  items: z.array(itemSchema).min(1, "至少一个商品"),
});

type OrderForm = z.infer<typeof orderSchema>;

function OrderForm() {
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<OrderForm>({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      customerName: "",
      items: [{ name: "", quantity: 1, price: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "items",
  });

  return (
    <form onSubmit={handleSubmit(console.log)}>
      <div>
        <label>客户名称</label>
        <input {...register("customerName")} />
        {errors.customerName && <span>{errors.customerName.message}</span>}
      </div>

      {fields.map((field, index) => (
        <div key={field.id}>
          <input {...register(`items.${index}.name`)} placeholder="商品名称" />
          <input {...register(`items.${index}.quantity`)} type="number" />
          <input {...register(`items.${index}.price`)} type="number" step="0.01" />
          <button type="button" onClick={() => remove(index)}>删除</button>
        </div>
      ))}

      <button type="button" onClick={() => append({ name: "", quantity: 1, price: 0 })}>
        添加商品
      </button>

      <button type="submit">提交订单</button>
    </form>
  );
}
```

---

## 14.5 测试策略

### 14.5.1 Vitest 单元测试

```typescript
// src/utils/format.test.ts
import { describe, it, expect, vi } from "vitest";
import { formatCurrency, formatDate, truncateText } from "./format";

describe("formatCurrency", () => {
  it("格式化正数", () => {
    expect(formatCurrency(1234.56)).toBe("¥1,234.56");
  });

  it("格式化零", () => {
    expect(formatCurrency(0)).toBe("¥0.00");
  });

  it("格式化负数", () => {
    expect(formatCurrency(-100)).toBe("-¥100.00");
  });
});

describe("formatDate", () => {
  it("格式化日期", () => {
    const date = new Date("2024-01-15T10:30:00Z");
    expect(formatDate(date)).toBe("2024-01-15");
  });
});

describe("truncateText", () => {
  it("短文本不截断", () => {
    expect(truncateText("Hello", 10)).toBe("Hello");
  });

  it("长文本截断并加省略号", () => {
    expect(truncateText("Hello, World!", 5)).toBe("Hello...");
  });
});
```

### 14.5.2 Mock 与类型安全

```typescript
// src/services/user.service.test.ts
import { describe, it, expect, vi } from "vitest";
import { UserService } from "./user.service";

// 类型安全的 Mock
const mockUserRepo = {
  findById: vi.fn(),
  findAll: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
} satisfies Record<keyof UserRepository, vi.Mock>;

// 使用 Mock 创建 Service
const userService = new UserService(mockUserRepo as unknown as UserRepository);

describe("UserService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findById", () => {
    it("找到用户时返回用户", async () => {
      const mockUser = { id: "1", name: "Tom", email: "tom@test.com" };
      mockUserRepo.findById.mockResolvedValue(mockUser);

      const result = await userService.findById("1");

      expect(result).toEqual(mockUser);
      expect(mockUserRepo.findById).toHaveBeenCalledWith("1");
    });

    it("找不到用户时抛出 NotFoundError", async () => {
      mockUserRepo.findById.mockResolvedValue(null);

      await expect(userService.findById("999")).rejects.toThrow("用户不存在");
    });
  });
});
```

### 14.5.3 React 组件测试

```typescript
// src/components/UserCard.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserCard } from "./UserCard";

describe("UserCard", () => {
  const defaultProps = {
    name: "Tom",
    email: "tom@test.com",
    role: "admin" as const,
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };

  it("渲染用户信息", () => {
    render(<UserCard {...defaultProps} />);

    expect(screen.getByText("Tom")).toBeInTheDocument();
    expect(screen.getByText("tom@test.com")).toBeInTheDocument();
    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("点击编辑按钮调用 onEdit", async () => {
    const user = userEvent.setup();
    render(<UserCard {...defaultProps} />);

    await user.click(screen.getByRole("button", { name: /编辑/i }));
    expect(defaultProps.onEdit).toHaveBeenCalledWith(defaultProps.name);
  });

  it("头像不存在时不渲染 img", () => {
    render(<UserCard {...defaultProps} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("头像存在时渲染 img", () => {
    render(<UserCard {...defaultProps} avatar="/avatar.png" />);
    expect(screen.getByRole("img")).toHaveAttribute("src", "/avatar.png");
  });
});
```

---

## 14.6 构建优化

### 14.6.1 Vite 配置优化

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [
    react(),
    // 打包分析
    visualizer({
      filename: "./dist/stats.html",
      open: true,
      gzipSize: true,
    }),
  ],

  resolve: {
    alias: {
      "@": "/src",
    },
  },

  build: {
    // 分包策略
    rollupOptions: {
      output: {
        manualChunks: {
          // React 核心
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          // UI 库
          "vendor-ui": ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu"],
          // 工具库
          "vendor-utils": ["zod", "date-fns", "clsx"],
        },
      },
    },
    // 启用 CSS 代码分割
    cssCodeSplit: true,
    // chunk 大小警告阈值
    chunkSizeWarningLimit: 500,
    // source map
    sourcemap: true,
  },

  // 开发服务器优化
  server: {
    port: 3000,
    open: true,
  },
});
```

### 14.6.2 路由懒加载

```typescript
// src/router.tsx
import { createBrowserRouter } from "react-router-dom";
import { lazy, Suspense } from "react";

// 懒加载路由组件
const Home = lazy(() => import("./pages/Home"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Settings = lazy(() => import("./pages/Settings"));
const Profile = lazy(() => import("./pages/Profile"));

// Loading 组件
function PageLoader() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
    </div>
  );
}

// Suspense 包装
function withSuspense(Component: React.LazyExoticComponent<() => JSX.Element>) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: withSuspense(Home) },
  { path: "/dashboard", element: withSuspense(Dashboard) },
  { path: "/settings", element: withSuspense(Settings) },
  { path: "/profile", element: withSuspense(Profile) },
]);
```

### 14.6.3 类型安全的 API 层

```typescript
// src/api/client.ts
import { z } from "zod";

// API 错误类型
class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, string[]>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// 类型安全的 fetch 封装
async function apiClient<
  T,
  S extends z.ZodType<T>
>(config: {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  schema: S;
  body?: unknown;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}): Promise<z.infer<S>> {
  let url = config.url;

  // 查询参数
  if (config.params) {
    const searchParams = new URLSearchParams(config.params);
    url += `?${searchParams.toString()}`;
  }

  const response = await fetch(url, {
    method: config.method,
    headers: {
      "Content-Type": "application/json",
      ...config.headers,
    },
    body: config.body ? JSON.stringify(config.body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      error.code ?? "UNKNOWN",
      error.message ?? response.statusText,
      error.details
    );
  }

  const data = await response.json();
  return config.schema.parse(data); // Zod 验证响应
}

// API 路由定义
const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(["admin", "user"]),
});

const userListSchema = z.object({
  data: z.array(userSchema),
  total: z.number(),
});

// 类型安全的 API 方法
export const api = {
  users: {
    list: (params?: { role?: string; page?: number }) =>
      apiClient({
        url: "/api/users",
        method: "GET",
        schema: userListSchema,
        params: params as Record<string, string> | undefined,
      }),

    getById: (id: string) =>
      apiClient({
        url: `/api/users/${id}`,
        method: "GET",
        schema: userSchema,
      }),

    create: (data: { name: string; email: string; role: "admin" | "user" }) =>
      apiClient({
        url: "/api/users",
        method: "POST",
        schema: userSchema,
        body: data,
      }),

    update: (id: string, data: Partial<{ name: string; email: string }>) =>
      apiClient({
        url: `/api/users/${id}`,
        method: "PUT",
        schema: userSchema,
        body: data,
      }),

    delete: (id: string) =>
      apiClient({
        url: `/api/users/${id}`,
        method: "DELETE",
        schema: z.object({ success: z.boolean() }),
      }),
  },
};
```

---

## 14.7 国际化类型安全

```typescript
// src/i18n/types.ts
type Locale = "zh" | "en";

type TranslationKeys = {
  common: {
    confirm: string;
    cancel: string;
    delete: string;
    save: string;
    search: string;
  };
  validation: {
    required: string;
    email: string;
    minLength: string;
    maxLength: string;
  };
  user: {
    login: string;
    logout: string;
    profile: string;
    settings: string;
    welcome: string; // 支持 {name} 插值
  };
};

// 翻译函数——类型安全
type NestedKeyOf<T> = T extends object
  ? { [K in keyof T & string]: `${K}` | `${K}.${NestedKeyOf<T[K]>` }[keyof T & string]
  : never;

type TranslationKey = NestedKeyOf<TranslationKeys>;

// 翻译函数签名
function t(key: TranslationKey, params?: Record<string, string | number>): string {
  // 实现省略
  return key;
}

// 使用——键名类型安全
t("common.confirm");           // ✅
t("user.welcome", { name: "Tom" }); // ✅
// t("common.notexist");       // ❌ 类型错误
```

---

## 14.8 性能优化模式

### 14.8.1 React.memo 与类型安全

```typescript
import { memo } from "react";

type ExpensiveListProps = {
  items: readonly { id: string; name: string; score: number }[];
  onSelect: (id: string) => void;
};

// React.memo + 类型安全
const ExpensiveList = memo(function ExpensiveList({ items, onSelect }: ExpensiveListProps) {
  console.log("ExpensiveList 重新渲染");
  return (
    <ul>
      {items.map((item) => (
        <li key={item.id} onClick={() => onSelect(item.id)}>
          {item.name}: {item.score}
        </li>
      ))}
    </ul>
  );
});

// 自定义比较函数
const ExpensiveListCustom = memo(
  function ExpensiveListCustom({ items, onSelect }: ExpensiveListProps) {
    return (
      <ul>
        {items.map((item) => (
          <li key={item.id} onClick={() => onSelect(item.id)}>
            {item.name}: {item.score}
          </li>
        ))}
      </ul>
    );
  },
  (prevProps, nextProps) => {
    // 只在 items 引用或 onSelect 引用变化时重新渲染
    return prevProps.items === nextProps.items && prevProps.onSelect === nextProps.onSelect;
  }
);
```

### 14.8.2 useMemo 与 useCallback 类型安全

```typescript
function Dashboard({ userId }: { userId: string }) {
  // useMemo——缓存计算结果
  const stats = React.useMemo(() => {
    return computeExpensiveStats(userId);
  }, [userId]);

  // useCallback——缓存回调函数
  const handleRefresh = React.useCallback(() => {
    refetchUserData(userId);
  }, [userId]);

  return <StatsDisplay stats={stats} onRefresh={handleRefresh} />;
}
```

### 14.8.3 虚拟列表类型安全

```typescript
import { useVirtualizer } from "@tanstack/react-virtual";

type VirtualListProps<T> = {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  estimateSize?: number;
  overscan?: number;
};

function VirtualList<T>({
  items,
  renderItem,
  estimateSize = 50,
  overscan = 5,
}: VirtualListProps<T>) {
  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  return (
    <div ref={parentRef} style={{ height: "600px", overflow: "auto" }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: "absolute",
              top: virtualItem.start,
              left: 0,
              width: "100%",
              height: virtualItem.size,
            }}
          >
            {renderItem(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 小结

| 主题 | 关键技术 | 适用场景 |
|------|---------|---------|
| 组件类型 | 泛型组件、组合组件 | 复用组件库 |
| Hooks 类型 | useReducer、自定义 Hook | 状态与逻辑复用 |
| 状态管理 | Zustand + 类型推导 | 全局状态 |
| 表单验证 | React Hook Form + Zod | 复杂表单 |
| 测试 | Vitest + Testing Library | 质量保障 |
| 构建优化 | Vite 分包、懒加载 | 性能优化 |
| API 层 | Zod 验证 + 类型推导 | 前后端类型安全 |
| 性能优化 | memo、虚拟列表 | 大数据量渲染 |