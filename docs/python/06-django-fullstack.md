# Django 全栈开发

## 1. ORM 高级查询

Django ORM 是 Django 最强大的组件之一。它不仅仅是 SQL 的简单封装，更是一套完整的对象关系映射系统。本节深入探讨其高级用法。

### 1.1 QuerySet 惰性求值

QuerySet 是**惰性（lazy）**的——构建 QuerySet 不会触发数据库查询，只有在**求值**时才会真正执行 SQL。

```python
# 以下操作不会产生任何数据库查询
qs = User.objects.filter(is_active=True)
qs = qs.exclude(role='banned')
qs = qs.order_by('-date_joined')

# 只有迭代/切片/布尔化等操作才会触发查询
users = list(qs)               # 触发: SELECT * FROM auth_user WHERE ...
exists = qs.exists()            # 触发: SELECT EXISTS(SELECT 1 ...)
count = qs.count()              # 触发: SELECT COUNT(*) ...
first = qs.first()              # 触发: SELECT ... LIMIT 1
page = qs[10:20]                # 触发: SELECT ... LIMIT 20 OFFSET 10
```

**关键认知**：QuerySet 结果会被缓存。重新遍历同一个 QuerySet 不会产生二次查询：

```python
qs = Article.objects.filter(published=True)

# 第一次遍历 —— 触发查询并缓存结果
for article in qs:
    print(article.title)

# 第二次遍历 —— 使用缓存，不再查库
for article in qs:
    print(article.title)

# ⚠️ 但一旦对 QuerySet 做了切片或求值操作，缓存行为会变化
qs = Article.objects.filter(published=True)
first_two = qs[:2]   # 新的 QuerySet，触发查询
all_items = list(qs) # 再次触发查询（因为 early slicing 产生了新 QuerySet）
```

**不要这样写**——每次 `in` 检查都会触发独立的 SQL：

```python
# ❌ N+1 查询：循环内每次判断都会查库
tags = Tag.objects.all()
for post in Post.objects.all():
    if post.tag in tags:  # 隐式触发 tags 的求值，但每次都会重新求值
        pass

# ✅ 先显式求值
tags = list(Tag.objects.all())
tag_set = set(tags)
for post in Post.objects.all():
    if post.tag in tag_set:
        pass
```

### 1.2  select_related 与 prefetch_related

这是解决 ORM N+1 查询问题的核心武器。

| 方法 | 适用关系 | SQL 策略 |
|------|---------|---------|
| `select_related` | ForeignKey, OneToOneField | SQL JOIN（单次查询） |
| `prefetch_related` | ManyToManyField, 反向 ForeignKey | 额外查询 + Python 组合 |

```python
# ---------- select_related 示例 ----------
# 模型：Book -> ForeignKey -> Author
# ❌ N+1：每本书查一次作者
books = Book.objects.all()
for book in books:
    print(book.author.name)  # 循环 N 次，每次一条 SQL

# ✅ 1+N -> 1 次查询：LEFT JOIN
books = Book.objects.select_related('author').all()
for book in books:
    print(book.author.name)  # 无额外查询

# 多级 JOIN
books = Book.objects.select_related('author__profile').all()
```

```python
# ---------- prefetch_related 示例 ----------
# 模型：Author -> ManyToMany -> Book（反向：author.book_set）
# ❌ N+1
authors = Author.objects.all()
for author in authors:
    books = list(author.books.all())  # 每个作者一次查询

# ✅ 2 次查询 + Python 组合
authors = Author.objects.prefetch_related('books').all()
for author in authors:
    books = list(author.books.all())  # 无额外查询
```

**Prefetch 对象**——更精细的控制：

```python
from django.db.models import Prefetch

# 对预取结果做过滤和排序
prefetch = Prefetch(
    'comments',
    queryset=Comment.objects.filter(approved=True).order_by('-created_at'),
    to_attr='approved_comments'  # 自定义属性名，不再使用 .all()
)

articles = Article.objects.prefetch_related(prefetch).all()
for article in articles:
    # 使用自定义属性，不再触发查询
    for comment in article.approved_comments:
        print(comment.body)
```

**高级组合**——链式混用：

```python
qs = (
    Order.objects
    .select_related('user', 'coupon')                    # FK: JOIN
    .prefetch_related(
        'items',                                         # M2M: 额外查询
        Prefetch('items__product', queryset=Product.objects.only('name', 'price')),
        Prefetch('logs', queryset=OrderLog.objects.filter(action='paid')),
    )
    .filter(created_at__gte=cutoff)
)
```

### 1.3 F 表达式与 Q 对象

**F 表达式**——在数据库层面操作字段值，避免竞态条件：

```python
from django.db.models import F

# 将 Post 的所有浏览量 +1 —— 原子操作
Post.objects.filter(id=post_id).update(views=F('views') + 1)

# ❌ 非原子操作（并发下数据不一致）
post = Post.objects.get(id=post_id)
post.views += 1
post.save()

# 字段间比较
# 找到所有"点赞数超过浏览量"的异常文章
abnormal = Article.objects.filter(likes__gt=F('views'))

# F 与算术运算
from django.db.models import F, Value
Article.objects.update(
    popularity=F('views') * 2 + Value(100)  # Value() 避免 Python 字面量被误解为字段名
)
```

**Q 对象**——构建复杂查询逻辑（OR / NOT / 嵌套）：

```python
from django.db.models import Q

# OR 条件
# 找到标题包含"Python"或"django"的文章
articles = Article.objects.filter(
    Q(title__icontains='Python') | Q(title__icontains='django')
)

# NOT 条件
# 排除已删除和待审核的文章
articles = Article.objects.filter(
    ~Q(status='deleted') & ~Q(status='pending')
)
# 等价于：
articles = Article.objects.exclude(status__in=['deleted', 'pending'])

# 混合 AND 与 OR
# Q 对象必须出现在位置参数之前（关键字参数与 Q 取 AND）
articles = Article.objects.filter(
    Q(published_at__year=2024) | Q(published_at__year=2025),
    status='published',            # 隐含 AND
    category__name='tech',         # 隐含 AND
)

# 纯 Q 构建（全部用 Q，避免混合歧义）
query = (
    Q(category__name='tech')
    & (Q(published_at__year=2024) | Q(published_at__year=2025))
    & ~Q(status='draft')
)
articles = Article.objects.filter(query)

# Q 对象动态组装（如 API 多条件搜索）
def build_search_filters(params: dict) -> Q:
    q = Q()
    if keyword := params.get('q'):
        q &= Q(title__icontains=keyword) | Q(body__icontains=keyword)
    if category := params.get('category'):
        q &= Q(category__slug=category)
    if tag_names := params.get('tags'):
        q &= Q(tags__name__in=tag_names.split(','))
    return q

filters = build_search_filters(request.GET)
results = Article.objects.filter(filters).distinct()
```

### 1.4 聚合与注解

```python
from django.db.models import Count, Sum, Avg, Max, Min, Q, F, FloatField
from django.db.models.functions import TruncMonth, ExtractYear

# -------- 基本注解（为每行附加计算字段）--------
# 每个分类下的文章数
categories = Category.objects.annotate(
    article_count=Count('articles')
)
for cat in categories:
    print(f"{cat.name}: {cat.article_count}")

# 条件聚合
users = User.objects.annotate(
    total_orders=Count('orders'),
    paid_orders=Count('orders', filter=Q(orders__status='paid')),
    total_spent=Sum('orders__amount', default=0),
)
print(users[0].paid_orders, users[0].total_spent)

# -------- 聚合（折叠为一行）--------
stats = Order.objects.aggregate(
    total_revenue=Sum('amount'),
    avg_order=Avg('amount'),
    max_order=Max('amount'),
    order_count=Count('id'),
)
print(stats['total_revenue'], stats['avg_order'])

# -------- 分组聚合 + 时间截断 --------
monthly_stats = (
    Order.objects
    .filter(status='completed')
    .annotate(month=TruncMonth('created_at'))
    .values('month')
    .annotate(
        revenue=Sum('amount'),
        count=Count('id'),
    )
    .order_by('month')
)

# -------- 自定义聚合函数（用 F 做表达式计算）--------
Product.objects.annotate(
    discount_price=F('price') * (1 - F('discount_percent') / 100)
)

# -------- 去重计数 --------
# .count() + distinct
distinct_cities = User.objects.values('city').distinct().count()

# -------- 多值聚合警告 --------
# 小心 annotate 后的 count() 不准：
# 如果一篇文章有 3 个标签，Blog.objects.annotate(tag_count=Count('tags')).count()
# 会返回重复行计数。应该使用：
from django.db.models import Count
# 正确：先去重
Blog.objects.annotate(tag_count=Count('tags')).distinct().count()
```

### 1.5 自定义 Manager 与 QuerySet

```python
# ---------- 自定义 QuerySet 实现链式查询 ----------
from django.db import models

class PostQuerySet(models.QuerySet):
    def published(self):
        return self.filter(status='published')

    def draft(self):
        return self.filter(status='draft')

    def from_author(self, author):
        return self.filter(author=author)

    def tagged(self, *tags):
        return self.filter(tags__slug__in=tags).distinct()

    def with_comment_count(self):
        return self.annotate(
            comment_count=Count('comments', filter=Q(comments__approved=True))
        )

    def search(self, keyword):
        return self.filter(
            Q(title__icontains=keyword) | Q(body__icontains=keyword)
        )


# ---------- 自定义 Manager ----------
class PostManager(models.Manager):
    """业务逻辑集中到 Manager 中"""

    def get_queryset(self):
        """默认排除软删除"""
        return PostQuerySet(self.model, using=self._db).filter(deleted_at__isnull=True)

    def published(self):
        return self.get_queryset().published()

    def weekly_digest(self):
        """本周热门文章，供邮件推送使用"""
        return (
            self.get_queryset()
            .published()
            .filter(created_at__gte=timezone.now() - timedelta(days=7))
            .annotate(week_views=Count('view_log'))
            .order_by('-week_views')[:10]
        )

    def with_all_relations(self):
        """预加载所有常用关联"""
        return (
            self.get_queryset()
            .select_related('author', 'category')
            .prefetch_related('tags', 'comments')
        )


class Post(models.Model):
    title = models.CharField(max_length=200)
    body = models.TextField()
    status = models.CharField(max_length=20, choices=(
        ('draft', 'Draft'), ('published', 'Published'), ('archived', 'Archived')
    ))
    author = models.ForeignKey('auth.User', on_delete=models.CASCADE)
    tags = models.ManyToManyField('Tag')
    deleted_at = models.DateTimeField(null=True, blank=True)

    objects = PostManager()  # 替换默认 manager

    class Meta:
        # 保留原始管理器用于管理命令等（可绕过软删除）
        default_manager_name = 'objects'


# ---------- 使用链式查询 ----------
posts = (
    Post.objects
    .published()
    .from_author(request.user)
    .tagged('python', 'django')
    .with_comment_count()
    .order_by('-created_at')[:20]
)
```

---

## 2. 信号系统

### 2.1 信号机制原理

Django 信号实现**观察者模式**：当某些事件发生时，发送信号，监听该信号的接收器函数被调用。

```
事件发生 -> 信号发送 (send/send_robust) -> 同步调用所有绑定的接收器
```

信号默认是**同步、阻塞**的。所有接收器在当前进程中顺序执行，执行完毕后程序才继续。

```python
from django.dispatch import Signal, receiver

# 定义信号
order_paid = Signal()
```

### 2.2 内置信号

```python
from django.db.models.signals import (
    pre_save, post_save, pre_delete, post_delete, m2m_changed
)
from django.core.signals import request_started, request_finished
from django.contrib.auth.signals import user_logged_in, user_logged_out

# ---------- post_save 典型应用：创建关联 Profile ----------
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.contrib.auth.models import User

@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """User 创建后自动创建 Profile"""
    if created:
        Profile.objects.create(user=instance)

@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    """User 保存时同步保存 Profile"""
    instance.profile.save()


# ---------- m2m_changed ----------
from django.db.models.signals import m2m_changed

@receiver(m2m_changed, sender=Post.tags.through)
def sync_tag_count(sender, instance, action, reverse, model, pk_set, **kwargs):
    """标签关联变更时更新标签的文章计数"""
    if action in ('post_add', 'post_remove', 'post_clear'):
        for tag_id in (pk_set or []):
            tag = Tag.objects.get(id=tag_id)
            tag.post_count = tag.posts.count()
            tag.save()


# ---------- request_finished 信号 ----------
from django.core.signals import request_finished

@receiver(request_finished)
def close_db_connections(sender, **kwargs):
    """请求结束后清理（Django 默认已做，此为示例）"""
    from django.db import connection
    if connection.connection and not connection.is_usable():
        connection.close()
```

### 2.3 自定义信号

```python
# ---------- signals.py ----------
import logging
from django.dispatch import Signal, receiver
from django.db.models.signals import post_save

logger = logging.getLogger(__name__)

# 自定义信号
order_paid = Signal()
order_refunded = Signal()
user_became_premium = Signal()


# ---------- handlers.py ----------
@receiver(order_paid)
def send_order_confirmation(sender, order, **kwargs):
    """订单支付后发送确认邮件"""
    from .tasks import send_email
    send_email.delay(
        to=order.user.email,
        subject=f"订单 {order.order_no} 支付成功",
        template='emails/order_confirmed.html',
        context={'order': order},
    )
    logger.info(f"Order {order.order_no} confirmation sent")


@receiver(order_paid)
def unlock_digital_goods(sender, order, **kwargs):
    """支付后解锁数字商品"""
    for item in order.items.filter(is_digital=True):
        item.unlock_for_user(order.user)


@receiver(order_refunded)
def process_refund(sender, order, reason, **kwargs):
    """处理退款逻辑"""
    if order.payment_method == 'alipay':
        alipay_client.refund(order.transaction_id, order.amount)
    elif order.payment_method == 'stripe':
        stripe.Refund.create(payment_intent=order.payment_intent_id)


# ---------- 使用信号：在视图中发送 ----------
# views.py
def complete_order(request, order_id):
    order = Order.objects.get(id=order_id)
    order.mark_as_paid()

    # 发送自定义信号
    order_paid.send(
        sender=Order,
        order=order,
        paid_at=timezone.now(),
        ip_address=request.META.get('REMOTE_ADDR'),
    )

    return JsonResponse({'status': 'ok'})


# ---------- 使用 send_robust 确保所有接收器被执行 ----------
@receiver(order_paid)
def fragile_handler(sender, **kwargs):
    """这个 handler 可能会抛异常"""
    if some_unlikely_condition:
        raise RuntimeError("Something went wrong")

# 如果用 send()，一个 handler 抛异常会阻断后续 handler
# 用 send_robust() 会捕获所有异常，保证每个 handler 都执行
# order_paid.send_robust(sender=Order, order=order)
```

### 2.4 信号最佳实践

**✅ 适用于信号场景：**

- **解耦上下游逻辑**：如用户注册后发邮件、创建 Profile
- **第三方 app 集成**：在不修改第三方代码的工程监听事件
- **缓存失效**：模型变更时清除对应缓存
- **日志审计**：记录重要数据变更

**❌ 不应使用信号的场景：**

```python
# ❌ 不要用信号做数据验证——应该在 Model.clean() 或 Serializer.validate() 做
@receiver(pre_save, sender=Order)
def validate_order_amount(sender, instance, **kwargs):
    if instance.amount < 0:
        raise ValueError("金额不能为负")  # 信号里抛验证异常，调用方不易捕获

# ❌ 不要在信号里执行耗时同步操作
@receiver(post_save, sender=Order)
def process_payment(sender, instance, **kwargs):
    http_client.post(payment_gateway, data=...)  # 阻塞请求，用户等待

# ✅ 应该用 Celery 异步任务
@receiver(post_save, sender=Order)
def dispatch_payment_task(sender, instance, **kwargs):
    process_payment_task.delay(order_id=instance.id)
```

**实用建议：**

```python
# 1. 信号接收器保持轻量
@receiver(post_save, sender=Order)
def invalidate_order_cache(sender, instance, **kwargs):
    cache.delete(f'order_detail:{instance.id}')  # 微秒级操作，适合信号

# 2. 避免信号循环（A 保存 -> 信号更新 B -> B 保存 -> 信号更新 A）
@receiver(post_save, sender=Order)
def update_user_order_count(sender, instance, **kwargs):
    # 用 update() 而不是 save() 避免触发信号循环
    User.objects.filter(id=instance.user_id).update(
        order_count=F('order_count') + 1
    )

# 3. 管理信号连接——使用 app 的 ready() 方法
# apps.py
from django.apps import AppConfig

class OrdersConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'orders'

    def ready(self):
        import orders.signals  # 显式导入信号模块以注册接收器

# 4. 信号接收器加 @receiver 装饰器，不要用 connect()——测试易 mock
```

---

## 3. 中间件与请求处理

### 3.1 中间件执行顺序

中间件形成**处理链**：请求依次经过 `__call__` 里的 `process_request` 阶段（从上到下），视图处理，然后响应经过 `process_response` 阶段（从下到上）。

```
请求
  │
  ▼
SecurityMiddleware      (process_request)
  │
  ▼
SessionMiddleware       (process_request)
  │
  ▼
CommonMiddleware        (process_request)
  │
  ▼
CsrfViewMiddleware      (process_request)
  │
  ▼
AuthenticationMiddleware (process_request)
  │
  ▼
MessageMiddleware       (process_request)
  │
  ▼
XFrameOptionsMiddleware  (process_request)
  │
  ▼
      视图函数
  │
  ▼
XFrameOptionsMiddleware  (process_response)
  │
  ▼
MessageMiddleware       (process_response)
  │
  ...
  │
  ▼
SecurityMiddleware      (process_response)
  │
  ▼
  响应返回客户端
```

**`MIDDLEWARE` 列表中顺序至关重要**：

```python
# settings.py
MIDDLEWARE = [
    # 安全相关 —— 必须最外层
    'django.middleware.security.SecurityMiddleware',

    # Session/Csrf —— 与认证相关
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',

    # 认证 —— 依赖 Session
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',

    # 最后 —— 防点击劫持
    'django.middleware.clickjacking.XFrameOptionsMiddleware',

    # 自定义 —— 通常放在后面（或根据依赖调整）
    'myapp.middleware.RequestTimingMiddleware',
    'myapp.middleware.ThreadLocalMiddleware',
]
```

### 3.2 自定义中间件

**方式一：函数式中间件（Django 1.10+ 推荐）**

```python
class RequestTimingMiddleware:
    """记录每个请求的处理耗时"""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # === 请求阶段（视图前执行）===
        start = time.perf_counter_ns()

        # 将计时信息附加到 request 对象
        request._start_time = start

        # 处理请求（调用下一个中间件或视图）
        response = self.get_response(request)

        # === 响应阶段（视图后执行）===
        duration_ms = (time.perf_counter_ns() - start) / 1_000_000
        response['X-Request-Duration-Ms'] = str(round(duration_ms, 2))

        logger.info(
            "Request %s %s: %.2fms",
            request.method, request.path, duration_ms
        )

        return response
```

**方式二：实现特定钩子方法**

```python
class BlockSuspiciousIPMiddleware:
    """基于请求头的 IP 黑名单过滤"""

    def __init__(self, get_response):
        self.get_response = get_response
        # 实际项目中从 Redis/DB 加载黑名单
        self.blacklist = {'10.0.0.99', '192.168.1.100'}

    def __call__(self, request):
        response = self.process_request(request)
        if response:
            return response
        return self.get_response(request)

    def process_request(self, request):
        ip = request.META.get('REMOTE_ADDR')
        if ip in self.blacklist:
            return HttpResponseForbidden("Your IP has been blocked")
        return None

    def process_view(self, request, view_func, view_args, view_kwargs):
        """在视图调用前执行——可以访问视图函数和参数"""
        # 例如：对特定视图做速率限制
        if view_func.__name__ == 'send_email':
            if request.session.get('last_email_sent', 0) > time.time() - 60:
                return HttpResponseTooManyRequests("Please wait")
        return None

    def process_exception(self, request, exception):
        """视图抛异常时执行"""
        if isinstance(exception, PermissionDenied):
            return redirect('/login/')
        return None
```

**实用案例：ThreadLocal 中间件**

```python
import threading
from django.utils.deprecation import MiddlewareMixin

_thread_locals = threading.local()

def get_current_request():
    """在任意位置获取当前请求（慎用——打破显式依赖）"""
    return getattr(_thread_locals, 'request', None)

def get_current_user():
    """在任意位置获取当前用户"""
    request = get_current_request()
    if request:
        return getattr(request, 'user', None)
    return None

class ThreadLocalMiddleware:
    """将 request 存入线程局部变量"""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        _thread_locals.request = request
        try:
            return self.get_response(request)
        finally:
            _thread_locals.request = None
```

### 3.3 异步中间件

```python
# Django 3.1+ 支持异步中间件
class AsyncRequestLogMiddleware:
    """异步请求日志中间件"""

    def __init__(self, get_response):
        self.get_response = get_response

    async def __call__(self, request):
        # 异步请求处理阶段
        request._req_id = uuid.uuid4().hex
        logger.info("Async request start: %s", request._req_id)

        response = await self.get_response(request)

        logger.info("Async request end: %s", request._req_id)
        response['X-Request-Id'] = request._req_id
        return response
```

**注意**：
- 如果中间件标记为 `async`，其后的整个中间件链也必须支持异步
- 混合使用 sync/async 中间件时，Django 会自动为它们创建同步/异步屏障，但会有性能开销
- 大部分项目在引入 ASGI 之前不需要异步中间件

### 3.4 中间件与依赖注入

```python
class ServiceContainerMiddleware:
    """轻量级服务容器注入"""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # 将服务注入 request（模拟 DI）
        request.services = {
            'payment': PaymentService(),
            'notification': NotificationService(),
            'analytics': AnalyticsService(),
        }
        response = self.get_response(request)
        return response


# 在视图中使用
def checkout(request):
    payment = request.services['payment']
    notification = request.services['notification']

    result = payment.charge(order=order)
    notification.send_order_confirmation(order)

    return JsonResponse({'status': 'ok'})
```

---

## 4. 缓存策略

### 4.1 缓存后端配置

```python
# ---------- settings.py ----------

# Redis 后端（推荐生产环境使用）
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': 'redis://:password@127.0.0.1:6379/1',
        'TIMEOUT': 300,          # 默认超时 300 秒
        'KEY_PREFIX': 'myapp',   # 前缀隔离不同项目
        'VERSION': 1,            # 版本号——用于缓存批量失效
        'OPTIONS': {
            'CLIENT_CLASS': 'django_redis.client.DefaultClient',
            'CONNECTION_POOL_CLASS': 'redis.BlockingConnectionPool',
            'CONNECTION_POOL_CLASS_KWARGS': {
                'max_connections': 50,
                'timeout': 20,
            },
            'SOCKET_CONNECT_TIMEOUT': 5,
            'SOCKET_TIMEOUT': 5,
        },
    },
    'session': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': 'redis://127.0.0.1:6379/2',
        'TIMEOUT': 86400,  # session 24h
    },
}

# 将 Session 存储切换到 Redis（替代数据库）
SESSION_ENGINE = 'django.contrib.sessions.backends.cache'
SESSION_CACHE_ALIAS = 'session'
```

### 4.2 缓存粒度策略

**全站缓存**：

```python
# settings.py
MIDDLEWARE = [
    'django.middleware.cache.UpdateCacheMiddleware',  # 放最前
    # ...其他中间件...
    'django.middleware.cache.FetchFromCacheMiddleware',  # 放最后
]

# 全站缓存时间（秒）
CACHE_MIDDLEWARE_SECONDS = 600
CACHE_MIDDLEWARE_KEY_PREFIX = 'site'
CACHE_MIDDLEWARE_ANONYMOUS_ONLY = True  # 仅缓存匿名用户
```

**视图缓存**：

```python
from django.views.decorators.cache import cache_page

# 方式一：装饰器
@cache_page(60 * 15)  # 缓存 15 分钟
def article_detail(request, slug):
    article = get_object_or_404(Article, slug=slug)
    return render(request, 'article.html', {'article': article})

# 方式二：URLconf 中设置（更灵活）
from django.views.decorators.cache import cache_page

urlpatterns = [
    path('article/<slug:slug>/',
         cache_page(60 * 15)(ArticleDetailView.as_view())),
]

# 方式三：视图内按条件缓存
from django.core.cache import cache

def article_detail(request, slug):
    # 已登录用户不缓存
    if request.user.is_authenticated:
        return render(...)

    cache_key = f'article_html:{slug}'
    html = cache.get(cache_key)
    if html is None:
        article = get_object_or_404(Article, slug=slug)
        html = render(request, 'article.html', {'article': article}).content
        cache.set(cache_key, html, 60 * 15)
    return HttpResponse(html)
```

**模板片段缓存**：

```django
{% load cache %}

{# 缓存侧边栏 30 分钟，按用户语言分区 #}
{% cache 1800 sidebar request.LANGUAGE_CODE %}
<div class="sidebar">
    {% for category in categories %}
        <h3>{{ category.name }}</h3>
        <ul>
        {% for post in category.recent_posts %}
            <li><a href="{{ post.get_absolute_url }}">{{ post.title }}</a></li>
        {% endfor %}
        </ul>
    {% endfor %}
</div>
{% endcache %}

{# 动态片段用 never cache #}
{% cache 0 live_counter %}
    <span id="visitor-count">{{ live_visitors }}</span>
{% endcache %}
```

**查询结果缓存**：

```python
from django.core.cache import cache
from django.db.models import Count

def get_top_articles(limit=10):
    """带缓存的热门文章列表"""
    cache_key = f'top_articles:{limit}'
    result = cache.get(cache_key)
    if result is not None:
        return result

    result = list(
        Article.objects.published()
        .annotate(view_count=Count('views'))
        .order_by('-view_count')[:limit]
    )
    cache.set(cache_key, result, 60 * 5)  # 5 分钟刷新一次
    return result
```

### 4.3 缓存键设计

```python
# ---------- 缓存键命名规范 ----------
# 模式: {app}:{model}:{action}:{identifier}:{version}

def make_cache_key(*, app, model, action, ident, version=1):
    parts = [app, model, action, str(ident), f'v{version}']
    return ':'.join(parts)


# ---------- 实际应用 ----------
class ArticleService:

    @staticmethod
    def detail_cache_key(article_id: int) -> str:
        return f'article:detail:{article_id}:v1'

    @staticmethod
    def list_cache_key(category_slug: str, page: int) -> str:
        return f'article:list:{category_slug}:page{page}:v1'

    @staticmethod
    def related_cache_key(article_id: int) -> str:
        return f'article:related:{article_id}:v1'


# ---------- 缓存版本管理 ----------
# 当数据结构变更时，递增版本号强制缓存刷新
# settings.py
CACHE_KEY_PREFIX = 'myapp:v2'  # 改版本号 = 全局缓存失效

# 或者按功能模块版本化
ARTICLE_CACHE_VERSION = 2        # 文章模块缓存版本
USER_CACHE_VERSION = 1           # 用户模块缓存版本
```

### 4.4 缓存失效

**主动失效（最可靠）**：

```python
from django.core.cache import cache

class Article(models.Model):
    # ...

    def save(self, *args, **kwargs):
        """保存时清除相关缓存"""
        # 清除详情缓存
        cache.delete(ArticleService.detail_cache_key(self.id))
        # 清除列表缓存（用模式匹配批量删除——Redis 支持 scan + delete）
        from django.core.cache import cache
        if hasattr(cache, 'delete_pattern'):
            cache.delete_pattern('article:list:*')

        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        cache.delete(ArticleService.detail_cache_key(self.id))
        super().delete(*args, **kwargs)
```

**信号驱动失效**：

```python
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

@receiver(post_save, sender=Article)
@receiver(post_delete, sender=Article)
def invalidate_article_cache(sender, instance, **kwargs):
    """Article 变更时自动清除缓存"""
    cache.delete_many([
        ArticleService.detail_cache_key(instance.id),
        'article:featured:v1',
    ])

    # 如果有 slug，也失效 slug 相关的缓存
    if hasattr(instance, 'slug'):
        cache.delete(f'article:slug:{instance.slug}')


@receiver(post_save, sender=Category)
def invalidate_category_cache(sender, **kwargs):
    """分类变更后清除全部分类缓存"""
    cache.delete('categories:tree:v2')
```

**基于时间的失效（TTL）**：

```python
# 不同数据使用不同 TTL
CACHE_TTL = {
    'article_detail': 60 * 30,           # 30 分钟
    'article_list': 60 * 5,               # 5 分钟
    'categories': 60 * 60 * 24,           # 24 小时
    'user_stats': 60 * 10,                # 10 分钟
    'sitemap': 60 * 60 * 12,              # 12 小时
}

def get_cached_article(article_id):
    cache_key = ArticleService.detail_cache_key(article_id)
    article = cache.get(cache_key)
    if article is None:
        article = Article.objects.select_related('author', 'category').get(id=article_id)
        cache.set(cache_key, article, CACHE_TTL['article_detail'])
    return article
```

**批量失效（Redis pattern delete）**：

```python
# 安装 django-redis 后支持 pattern 删除
# pip install django-redis

from django.core.cache import cache

def invalidate_user_cache(user_id: int):
    """清除某个用户关联的全部缓存"""
    if hasattr(cache, 'delete_pattern'):
        # 匹配 user:{user_id}:*
        cache.delete_pattern(f'user:{user_id}:*')

def invalidate_all_article_cache():
    """全局刷新文章缓存（如发布重大新闻时）"""
    if hasattr(cache, 'delete_pattern'):
        cache.delete_pattern('article:*')
```

---

## 5. Django REST Framework

### 5.1 Serializer 高级用法

**嵌套序列化与自定义字段**：

```python
from rest_framework import serializers
from .models import Order, OrderItem, Product, User


class UserBriefSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'avatar_url']


class ProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = Product
        fields = ['id', 'name', 'price', 'stock', 'image_url']


class OrderItemSerializer(serializers.ModelSerializer):
    product = ProductSerializer(read_only=True)
    subtotal = serializers.SerializerMethodField()

    class Meta:
        model = OrderItem
        fields = ['id', 'product', 'quantity', 'price', 'subtotal']

    def get_subtotal(self, obj) -> float:
        return round(obj.quantity * obj.price, 2)


class OrderSerializer(serializers.ModelSerializer):
    user = UserBriefSerializer(read_only=True)
    items = OrderItemSerializer(many=True, read_only=True)
    total_amount = serializers.SerializerMethodField()
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = Order
        fields = [
            'id', 'order_no', 'user', 'items',
            'total_amount', 'status', 'status_display',
            'created_at', 'paid_at',
        ]

    def get_total_amount(self, obj) -> float:
        return round(sum(
            item.quantity * item.price for item in obj.items.all()
        ), 2)
```

**字段级别的验证与自定义验证**：

```python
class CreateOrderSerializer(serializers.Serializer):
    product_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        min_length=1,
        max_length=50,
    )
    coupon_code = serializers.CharField(required=False, max_length=20)
    shipping_address_id = serializers.IntegerField(required=True)
    remark = serializers.CharField(required=False, max_length=500, allow_blank=True)

    def validate_product_ids(self, value):
        """验证所有商品 ID 是否存在且可购买"""
        existing = set(Product.objects.filter(
            id__in=value, is_active=True, stock__gt=0
        ).values_list('id', flat=True))
        missing = set(value) - existing
        if missing:
            raise serializers.ValidationError(
                f"以下商品不可购买: {missing}"
            )
        return value

    def validate(self, attrs):
        """跨字段验证"""
        # 验证优惠券是否可用
        if code := attrs.get('coupon_code'):
            if not Coupon.objects.filter(code=code, is_active=True).exists():
                raise serializers.ValidationError(
                    {'coupon_code': '优惠券无效或已过期'}
                )

        # 验证收货地址属于当前用户
        user = self.context['request'].user
        if not user.addresses.filter(id=attrs['shipping_address_id']).exists():
            raise serializers.ValidationError(
                {'shipping_address_id': '收货地址不存在'}
            )

        return attrs
```

**动态字段控制**：

```python
class DynamicFieldsSerializer(serializers.ModelSerializer):
    """
    支持通过 ?fields=id,title,created_at 查询参数控制返回字段
    """
    def __init__(self, *args, **kwargs):
        fields = kwargs.pop('fields', None)
        super().__init__(*args, **kwargs)

        if fields is not None:
            allowed = set(fields.split(','))
            existing = set(self.fields)
            for field_name in existing - allowed:
                self.fields.pop(field_name)


# 视图中的使用
class ArticleListView(APIView):
    def get(self, request):
        articles = Article.objects.published()
        serializer = DynamicFieldsSerializer(
            articles, many=True,
            fields=request.query_params.get('fields'),
        )
        return Response(serializer.data)
```

### 5.2 ViewSet 与 Router

```python
from rest_framework import viewsets, status, mixins
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, IsAdminUser


class ArticleViewSet(viewsets.ModelViewSet):
    """
    ViewSet 自动生成 list / create / retrieve / update / destroy 五个 Action
    通过 Router 自动注册 URL
    """
    queryset = Article.objects.published()
    serializer_class = ArticleSerializer
    permission_classes = [IsAuthenticated]
    lookup_field = 'slug'  # 用 slug 而非 id

    def get_queryset(self):
        """按需过滤 QuerySet"""
        qs = super().get_queryset()
        if self.action == 'list':
            # 列表视图：支持分类筛选
            if category := self.request.query_params.get('category'):
                qs = qs.filter(category__slug=category)
            if tag := self.request.query_params.get('tag'):
                qs = qs.filter(tags__slug=tag)
        return qs

    def perform_create(self, serializer):
        """创建时自动设置 author"""
        serializer.save(author=self.request.user)

    # -------- 自定义 Action --------
    @action(detail=True, methods=['post'], url_path='publish')
    def publish(self, request, slug=None):
        """发布文章"""
        article = self.get_object()
        article.status = 'published'
        article.published_at = timezone.now()
        article.save()
        return Response({'status': 'published'})

    @action(detail=False, methods=['get'], url_path='featured')
    def featured(self, request):
        """精选文章列表"""
        articles = self.get_queryset().filter(is_featured=True)[:5]
        serializer = self.get_serializer(articles, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def like(self, request, slug=None):
        """点赞（需要翻墙速率限制）"""
        article = self.get_object()
        # 省略去重逻辑
        article.likes_count = F('likes_count') + 1
        article.save(update_fields=['likes_count'])
        article.refresh_from_db()
        return Response({'likes': article.likes_count})

    @action(detail=True, methods=['get'], url_path='analytics')
    def analytics(self, request, slug=None):
        """文章统计分析（仅管理员）"""
        self.check_object_permissions(request, self.get_object())
        article = self.get_object()
        from django.db.models import Count
        data = {
            'total_views': article.views.count(),
            'daily_views': (
                article.views
                .extra(select={'day': "date(created_at)"})
                .values('day')
                .annotate(count=Count('id'))
                .order_by('day')[:30]
            ),
        }
        return Response(data)


# ---------- Router 注册 ----------
from rest_framework.routers import DefaultRouter

router = DefaultRouter()
router.register(r'articles', ArticleViewSet, basename='article')
router.register(r'categories', CategoryViewSet, basename='category')
router.register(r'users', UserViewSet, basename='user')

urlpatterns = router.urls

# 生成的 URL：
# GET    /articles/                  -> list
# POST   /articles/                  -> create
# GET    /articles/{slug}/           -> retrieve
# PUT    /articles/{slug}/           -> update
# PATCH  /articles/{slug}/           -> partial_update
# DELETE /articles/{slug}/           -> destroy
# POST   /articles/{slug}/publish/   -> publish
# GET    /articles/featured/         -> featured
# POST   /articles/{slug}/like/      -> like
# GET    /articles/{slug}/analytics/ -> analytics
```

**混入组合（Mixins）**：

```python
class ReadOnlyViewSet(mixins.RetrieveModelMixin,
                      mixins.ListModelMixin,
                      viewsets.GenericViewSet):
    """只读 ViewSet——隐式不生成 create/update/delete"""
    pass


class CreateListRetrieveViewSet(mixins.CreateModelMixin,
                                mixins.ListModelMixin,
                                mixins.RetrieveModelMixin,
                                viewsets.GenericViewSet):
    """允许创建/列表/详情，禁止修改/删除"""
    pass
```

### 5.3 认证与权限

**自定义权限类**：

```python
from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsAuthorOrReadOnly(BasePermission):
    """仅作者可写，其他用户只读"""

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        return obj.author == request.user


class IsOwner(BasePermission):
    """仅资源所有者可访问"""

    def has_object_permission(self, request, view, obj):
        return obj.user == request.user


class InGroupPermission(BasePermission):
    """动态检查用户是否在指定组"""

    def __init__(self, group_name: str):
        self.group_name = group_name

    def has_permission(self, request, view):
        return request.user.groups.filter(name=self.group_name).exists()


class PostLimitPerDay(BasePermission):
    """每天仅允许发布 N 篇文章"""

    def has_permission(self, request, view):
        if view.action != 'create':
            return True
        today_min = timezone.now().replace(hour=0, minute=0, second=0)
        count = Article.objects.filter(
            author=request.user, created_at__gte=today_min
        ).count()
        return count < 5  # 每天最多 5 篇


# ---------- 视图中的组合使用 ----------
class ArticleViewSet(viewsets.ModelViewSet):
    queryset = Article.objects.published()
    serializer_class = ArticleSerializer

    permission_classes = [IsAuthenticated, IsAuthorOrReadOnly]

    def get_permissions(self):
        """按 action 返回不同权限组合"""
        if self.action == 'destroy':
            # 删除需要管理员权限
            return [permission() for permission in [IsAdminUser]]
        elif self.action == 'create':
            return [permission() for permission in [
                IsAuthenticated, PostLimitPerDay
            ]]
        return super().get_permissions()
```

**多认证方案**：

```python
# settings.py
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.SessionAuthentication',
        'rest_framework.authentication.TokenAuthentication',
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
}


# ---------- JWT 集成示例 ----------
# pip install djangorestframework-simplejwt
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView

class CustomTokenObtainPairView(TokenObtainPairView):
    """自定义 JWT 登录：返回用户信息 + Token"""

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            user = request.user
            response.data['user'] = {
                'id': user.id,
                'username': user.username,
                'avatar': user.profile.avatar_url if hasattr(user, 'profile') else None,
            }
        return response


# 手动生成 Token
def get_tokens_for_user(user):
    refresh = RefreshToken.for_user(user)
    return {
        'refresh': str(refresh),
        'access': str(refresh.access_token),
    }
```

### 5.4 分页与过滤

```python
# ---------- 自定义分页 ----------
from rest_framework.pagination import (
    PageNumberPagination, LimitOffsetPagination, CursorPagination
)


class StandardResultsPagination(PageNumberPagination):
    """标准页码分页"""
    page_size = 20
    page_size_query_param = 'page_size'   # 客户端可自定义每页数量
    max_page_size = 100
    page_query_param = 'page'             # 页码参数名


class ArticleCursorPagination(CursorPagination):
    """游标分页（基于有序字段，适合无限滚动）"""
    page_size = 20
    ordering = '-created_at'
    cursor_query_param = 'cursor'


# settings.py 全局配置
REST_FRAMEWORK = {
    'DEFAULT_PAGINATION_CLASS': 'myapp.pagination.StandardResultsPagination',
    'PAGE_SIZE': 20,
}


# ---------- django-filter 集成 ----------
# pip install django-filter
from django_filters import rest_framework as filters


class ArticleFilter(filters.FilterSet):
    """文章过滤器"""
    title = filters.CharFilter(lookup_expr='icontains')
    created_after = filters.DateTimeFilter(field_name='created_at', lookup_expr='gte')
    created_before = filters.DateTimeFilter(field_name='created_at', lookup_expr='lte')
    min_views = filters.NumberFilter(field_name='views_count', lookup_expr='gte')
    max_views = filters.NumberFilter(field_name='views_count', lookup_expr='lte')
    status = filters.MultipleChoiceFilter(choices=Article.STATUS_CHOICES)
    tags = filters.ModelMultipleChoiceFilter(
        field_name='tags__slug',
        to_field_name='slug',
        conjoined=False,  # OR 关系；True 为 AND
        queryset=Tag.objects.all(),
    )

    class Meta:
        model = Article
        fields = [
            'title', 'author', 'category', 'status',
            'created_after', 'created_before',
        ]


class ArticleViewSet(viewsets.ModelViewSet):
    queryset = Article.objects.published()
    serializer_class = ArticleSerializer
    pagination_class = StandardResultsPagination
    filter_backends = [
        filters.DjangoFilterBackend,
        rest_framework.filters.SearchFilter,
        rest_framework.filters.OrderingFilter,
    ]
    filterset_class = ArticleFilter
    search_fields = ['title', 'body', '^tags__name']   # ^prefix 为前缀匹配
    ordering_fields = ['created_at', 'views_count', 'likes_count']
    ordering = ['-created_at']


# API 调用示例：
# GET /api/articles/?status=published&tags=django,python&created_after=2024-01-01
# GET /api/articles/?search=async+python&ordering=-views_count
# GET /api/articles/?page=3&page_size=50
```

### 5.5 嵌套序列化

```python
class CategoryWithArticlesSerializer(serializers.ModelSerializer):
    """分类及其文章列表（嵌套序列化）"""
    articles = ArticleSerializer(many=True, read_only=True)
    article_count = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ['id', 'name', 'slug', 'article_count', 'articles']

    def get_article_count(self, obj) -> int:
        return obj.articles.count()


# ---------- 写操作嵌套 ----------
class OrderCreateSerializer(serializers.Serializer):
    """创建订单时同时创建订单项"""
    shipping_address_id = serializers.IntegerField()
    items = OrderItemCreateSerializer(many=True, min_length=1)

    def create(self, validated_data):
        items_data = validated_data.pop('items')
        user = self.context['request'].user

        # 创建订单
        order = Order.objects.create(
            user=user,
            shipping_address_id=validated_data['shipping_address_id'],
            order_no=self._generate_order_no(),
        )

        # 批量创建订单项
        order_items = [
            OrderItem(
                order=order,
                product_id=item['product_id'],
                quantity=item['quantity'],
                price=Product.objects.get(id=item['product_id']).price,
            )
            for item in items_data
        ]
        OrderItem.objects.bulk_create(order_items)

        # 扣减库存
        for item in items_data:
            Product.objects.filter(id=item['product_id']).update(
                stock=F('stock') - item['quantity']
            )

        return order

    @staticmethod
    def _generate_order_no() -> str:
        import datetime, random
        now = datetime.datetime.now()
        return f"{now.strftime('%Y%m%d%H%M%S')}{random.randint(1000, 9999)}"


# ---------- 深度嵌套 & 性能优化 ----------
class DeepArticleSerializer(serializers.ModelSerializer):
    """深度嵌套序列化 + 性能提示"""
    author = UserBriefSerializer(read_only=True)
    category = serializers.SlugRelatedField(slug_field='name', read_only=True)
    tags = serializers.SlugRelatedField(
        many=True, slug_field='name', read_only=True
    )
    comments = serializers.SerializerMethodField()

    class Meta:
        model = Article
        fields = '__all__'

    def get_comments(self, obj):
        # 使用 prefetched 数据，避免 N+1
        # 在视图中需调用 .prefetch_related('comments')
        qs = getattr(obj, '_prefetched_objects_cache', {}).get('comments')
        if qs is not None:
            return CommentBriefSerializer(
                qs, many=True, context=self.context
            ).data
        return []

    def to_representation(self, instance):
        """全局自定义输出格式"""
        data = super().to_representation(instance)
        # 移除敏感字段
        data.pop('internal_notes', None)
        data.pop('draft_body', None)
        return data


# ---------- 视图层优化——预加载关联数据 ----------
class OptimizedArticleViewSet(viewsets.ReadOnlyModelViewSet):
    """明确预加载所有嵌套序列化需要的关联"""

    queryset = Article.objects.published().select_related(
        'author', 'category'
    ).prefetch_related(
        'tags', 'comments', 'comments__user',
    )
    serializer_class = DeepArticleSerializer
```

---

本章节涵盖了一个中级 Django 开发者进阶到高级水平所需的核心知识。实践时请记住：

1. **ORM**：时刻留意 N+1 问题，巧妙运用 `select_related` / `prefetch_related`
2. **信号**：保持接收器轻量、无副作用，用 Celery 处理耗时操作
3. **中间件**：注意执行顺序，自定义中间件遵循 `__call__` 模式
4. **缓存**：先在数据库层优化，再用缓存；设计好缓存键与失效策略
5. **DRF**：善用 ViewSet + Router 减少样板代码，权限与过滤尽量在框架层完成
