# Python 脚本开发与自动化

当 Python 基础知识已经掌握，接下来真正让 Python 发挥生产力的场景之一就是**脚本开发与自动化**。从日常的文件处理、定时任务，到运维监控、批量部署，Python 都能用极少的代码完成原本需要大量手工操作的工作。

本章面向已有 Python 基础的开发者，深入讲解 CLI 工具、文件处理、子进程管理、任务调度、日志系统以及实战自动化脚本的编写。

---

## 1. CLI 工具开发

### 1.1 argparse 进阶

`argparse` 是 Python 标准库中强大的命令行参数解析模块。基础用法不再赘述，这里聚焦高阶技巧。

```python
# cli_advanced.py — argparse 高级用法
import argparse
import configparser
import os
import sys
from pathlib import Path
from typing import Optional


def load_config(config_file: Optional[str] = None) -> dict:
    """从 INI 配置文件加载默认参数"""
    cfg = configparser.ConfigParser()
    if config_file and Path(config_file).exists():
        cfg.read(config_file)
        return dict(cfg.items("DEFAULT", fallback={}))
    return {}


def positive_int(value: str) -> int:
    """自定义类型验证函数"""
    ivalue = int(value)
    if ivalue <= 0:
        raise argparse.ArgumentTypeError(f"{value} 必须是正整数")
    return ivalue


def build_parser() -> argparse.ArgumentParser:
    """构建带子命令的复杂 CLI"""
    parser = argparse.ArgumentParser(
        prog="deploy-tool",
        description="自动化部署工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
使用示例:
  deploy-tool deploy --env staging --timeout 120
  deploy-tool rollback --version 1.2.3
  deploy-tool status --watch
        """,
    )

    # 全局参数
    parser.add_argument(
        "-c", "--config",
        type=str,
        default=None,
        help="配置文件路径 (INI 格式)",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="输出详细日志",
    )

    # 子命令
    subparsers = parser.add_subparsers(dest="command", required=True, help="可用子命令")

    # ---- deploy 子命令 ----
    deploy_parser = subparsers.add_parser("deploy", help="部署服务")
    deploy_parser.add_argument("--env", "-e", choices=["dev", "staging", "prod"],
                               default="dev", help="部署环境")
    deploy_parser.add_argument("--timeout", "-t", type=positive_int, default=60,
                               help="部署超时时间(秒)")
    deploy_parser.add_argument("--dry-run", action="store_true",
                               help="模拟运行，不实际执行")

    # ---- rollback 子命令 ----
    rollback_parser = subparsers.add_parser("rollback", help="回滚版本")
    rollback_parser.add_argument("--version", required=True, type=str,
                                 help="回滚到的目标版本")
    rollback_parser.add_argument("--force", action="store_true",
                                 help="强制回滚，跳过确认")

    # ---- status 子命令 ----
    status_parser = subparsers.add_parser("status", help="查看服务状态")
    status_parser.add_argument("--watch", "-w", action="store_true",
                               help="持续监控状态变化")
    status_parser.add_argument("--interval", type=float, default=2.0,
                               help="监控间隔(秒)")

    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    # 从配置文件加载默认值（如果提供）
    config = load_config(args.config)

    if args.command == "deploy":
        print(f"[deploy] 环境: {args.env}")
        print(f"[deploy] 超时: {args.timeout}s")
        print(f"[deploy] Dry-run: {args.dry_run}")
    elif args.command == "rollback":
        print(f"[rollback] 版本: {args.version}, 强制: {args.force}")
    elif args.command == "status":
        print(f"[status] Watch: {args.watch}, 间隔: {args.interval}s")


if __name__ == "__main__":
    main()
```

```bash
# 使用示例
python cli_advanced.py deploy --env prod --timeout 120
python cli_advanced.py rollback --version 2.0.0 --force
python cli_advanced.py -c deploy.ini status --watch --interval 5
```

### 1.2 Click 框架

[Click](https://click.palletsprojects.com/) 是 Flask 团队开发的 CLI 框架，通过装饰器优雅地构建命令行工具。

```python
# click_demo.py — Click 框架入门到进阶
import json
import sys
from pathlib import Path

import click


# ---- 基础用法 ----
@click.command()
@click.option("--name", prompt="你的名字", help="用户名")
@click.option("--count", default=1, help="重复次数")
def hello(name: str, count: int):
    """简单的问候 CLI"""
    for _ in range(count):
        click.echo(f"你好, {name}!")


# ---- 进阶：子命令 + 上下文传递 ----
@click.group()
@click.option("--debug/--no-debug", default=False)
@click.option("--config", type=click.Path(exists=True), default=None)
@click.pass_context
def cli(ctx: click.Context, debug: bool, config: str | None):
    """DevOps 工具箱"""
    ctx.ensure_object(dict)
    ctx.obj["DEBUG"] = debug
    ctx.obj["CONFIG"] = config
    # 全局初始化逻辑
    if debug:
        click.echo("调试模式已开启", err=True)


@cli.command()
@click.option("--src", required=True, type=click.Path(exists=True))
@click.option("--dest", required=True, type=click.Path())
@click.option("--workers", default=4, type=click.IntRange(1, 32))
@click.pass_context
def sync(ctx: click.Context, src: str, dest: str, workers: int):
    """同步文件到目标服务器"""
    click.echo(f"[sync] 源: {src} -> 目标: {dest}")
    click.echo(f"[sync] 工作线程: {workers}")
    if ctx.obj["DEBUG"]:
        click.echo(f"[debug] 配置文件: {ctx.obj['CONFIG']}", err=True)

    # 进度条示例
    files = list(Path(src).rglob("*"))
    with click.progressbar(files, label="同步进度") as bar:
        for f in bar:
            # 模拟文件同步
            pass
    click.secho("✅ 同步完成!", fg="green", bold=True)


@cli.command()
@click.argument("service", type=click.Choice(["nginx", "mysql", "redis"]))
@click.option("--action", type=click.Choice(["start", "stop", "restart"]),
              default="restart")
def service(service: str, action: str):
    """管理服务启停"""
    click.echo(f"[service] {action} {service}")
    # 模拟执行
    click.echo(click.style("✓", fg="green") + f" {service} {action} 成功")


# ---- 提示输入与密码 ----
@cli.command()
@click.option("--username", prompt=True)
@click.password_option()
def login(username: str, password: str):
    """登录认证（演示密码输入）"""
    if username == "admin" and password == "secret":
        click.echo(click.style("登录成功", fg="green", bold=True))
    else:
        click.echo(click.style("登录失败", fg="red"))
        sys.exit(1)


if __name__ == "__main__":
    cli(obj={})
```

```bash
# 使用方式
python click_demo.py sync --src ./dist --dest /srv/app --workers 8
python click_demo.py service nginx --action restart
python click_demo.py login
```

### 1.3 Typer — 类型注解驱动的 CLI

[Typer](https://typer.tiangolo.com/) 基于 Python 类型注解自动生成 CLI，代码更简洁。

```python
# typer_demo.py — Typer 快速构建 CLI
import json
import time
from pathlib import Path
from typing import Optional

import typer

# 创建应用实例
app = typer.Typer(
    name="taskctl",
    help="任务管理与调度工具",
    rich_markup_mode="rich",
)
state = {"verbose": False}


# ---- 回调：全局参数 ----
@app.callback()
def main_callback(
    verbose: bool = typer.Option(False, "--verbose", "-v", help="启用详细输出"),
    config: Optional[Path] = typer.Option(None, "--config", "-c", help="配置文件"),
):
    """全局回调，在子命令之前执行"""
    state["verbose"] = verbose
    if config and config.exists():
        data = json.loads(config.read_text())
        state.update(data)
        if verbose:
            typer.echo(f"已加载配置: {config}")


# ---- 子命令 ----
@app.command()
def run(
    task_name: str = typer.Argument(..., help="任务名称"),
    retries: int = typer.Option(3, "--retries", "-r", min=0, max=10,
                                help="重试次数"),
    timeout: float = typer.Option(30.0, "--timeout", "-t",
                                  help="超时秒数"),
    env: str = typer.Option("dev", "--env", "-e"),
):
    """运行指定任务"""
    typer.echo(f"运行任务: [bold]{task_name}[/bold]")
    typer.echo(f"  环境: {env}, 重试: {retries}, 超时: {timeout}s")

    for attempt in range(1, retries + 1):
        typer.echo(f"尝试第 {attempt}/{retries} 次...")
        time.sleep(0.3)  # 模拟执行
    typer.secho("✓ 任务完成", fg=typer.colors.GREEN)


@app.command()
def list_tasks(
    pattern: str = typer.Option("*", "--pattern", "-p", help="过滤模式"),
    sort_by: str = typer.Option("name", help="排序字段"),
    show_hidden: bool = typer.Option(False, "--all", "-a"),
):
    """列出可用任务"""
    tasks = ["build", "deploy", "test", "cleanup", "backup"]
    if pattern != "*":
        tasks = [t for t in tasks if pattern in t]

    typer.echo(f"{'任务名称':<12} {'状态':<8} {'优先级'}")
    typer.echo("-" * 36)
    for task in tasks:
        typer.echo(f"{task:<12} {'🟢 就绪':<8} {'P0' if task == 'deploy' else 'P1'}")


@app.command()
def watch(
    interval: float = typer.Argument(2.0, help="监控间隔(秒)"),
    count: int = typer.Option(10, help="监控次数"),
):
    """持续监控任务状态"""
    with typer.progressbar(range(count), label="监控中") as bar:
        for i in bar:
            time.sleep(interval)


if __name__ == "__main__":
    app()
```

```bash
# 使用方式
python typer_demo.py run deploy --retries 5 --env prod
python typer_demo.py list-tasks --pattern build
python typer_demo.py --help
```

**三者对比：**

| 特性 | argparse | Click | Typer |
|------|----------|-------|-------|
| 依赖 | 标准库 | 第三方 | 第三方 (基于 Click) |
| 代码量 | 较多 | 中等 | 最少 |
| 类型提示 | 不原生支持 | 部分 | 完全支持 |
| 子命令 | 手动实现 | 装饰器 | 装饰器 |
| 适用场景 | 标准库受限场景 | 中大型 CLI | 快速原型/优雅 CLI |

### 1.4 配置文件集成

成熟 CLI 工具通常需要从多种来源读取配置，遵循**优先级：CLI 参数 > 环境变量 > 配置文件 > 默认值**。

```python
# config_loader.py — 多源配置加载
import json
import os
import configparser
from pathlib import Path
from typing import Any, Dict, Optional


class ConfigLoader:
    """分层配置加载器"""

    def __init__(self, app_name: str):
        self.app_name = app_name
        self._config: Dict[str, Any] = {}

    def load_defaults(self, defaults: Dict[str, Any]) -> "ConfigLoader":
        """第 4 层：默认值"""
        self._config.update(defaults)
        return self

    def load_file(self, path: Optional[str] = None) -> "ConfigLoader":
        """第 3 层：配置文件"""
        paths_to_try = []

        if path:
            paths_to_try.append(Path(path))
        # 常见的配置文件位置
        paths_to_try.extend([
            Path(f"{self.app_name}.json"),
            Path(f"{self.app_name}.ini"),
            Path.home() / f".{self.app_name}" / "config.json",
            Path(f"/etc/{self.app_name}/config.json"),
        ])

        for config_path in paths_to_try:
            if config_path and config_path.exists():
                if config_path.suffix == ".json":
                    self._config.update(json.loads(config_path.read_text()))
                elif config_path.suffix == ".ini":
                    cfg = configparser.ConfigParser()
                    cfg.read(str(config_path))
                    self._config.update(dict(cfg.items("DEFAULT", fallback={})))
                break  # 第一个找到的配置文件优先
        return self

    def load_env(self, prefix: Optional[str] = None) -> "ConfigLoader":
        """第 2 层：环境变量，格式如 MYAPP_RETRIES=5"""
        prefix = (prefix or self.app_name).upper()
        for key, value in os.environ.items():
            if key.startswith(f"{prefix}_"):
                config_key = key[len(prefix) + 1:].lower()
                # 类型推断
                if value.isdigit():
                    value = int(value)
                elif value.lower() in ("true", "false"):
                    value = value.lower() == "true"
                self._config[config_key] = value
        return self

    def get(self, key: str, default: Any = None) -> Any:
        return self._config.get(key, default)

    @property
    def data(self) -> Dict[str, Any]:
        return self._config.copy()


# 使用示例
config = (
    ConfigLoader("myapp")
    .load_defaults({"retries": 3, "timeout": 30, "verbose": False})
    .load_file("myapp.json")
    .load_env("MYAPP")
)

print(config.get("retries"))   # 环境变量 MYAPP_RETRIES=5 则返回 5
```

---

## 2. 文件与目录处理

### 2.1 pathlib 高级用法

`pathlib` 是 Python 3.4+ 中面向对象的文件路径库，应替代 `os.path`。

```python
# pathlib_advanced.py — pathlib 高阶操作
from pathlib import Path
import shutil
import stat
import os

# ---- 批量创建目录结构 ----
paths = [
    "project/src/core",
    "project/src/utils",
    "project/tests/unit",
    "project/tests/integration",
    "project/docs",
    "project/data/raw",
    "project/data/processed",
]
base = Path("my-workspace")
for p in paths:
    (base / p).mkdir(parents=True, exist_ok=True)

# ---- 文件操作链式 API ----
file_path = base / "src" / "core" / "config.yaml"
file_path.write_text("debug: true\nport: 8080\n", encoding="utf-8")

# 读取并解析
content = file_path.read_text(encoding="utf-8")
print(content)

# ---- 通配符与递归搜索 ----
print("所有 .yaml 文件:")
for yaml_file in base.rglob("*.yaml"):
    print(f"  {yaml_file.relative_to(base)}")

# ---- 文件属性 ----
if file_path.exists():
    print(f"""
  文件名: {file_path.name}
  纯文件名: {file_path.stem}
  扩展名: {file_path.suffix}
  父目录: {file_path.parent}
  绝对路径: {file_path.absolute()}
  大小: {file_path.stat().st_size} bytes
  修改时间: {file_path.stat().st_mtime}
""")

# ---- 权限与 owner ----
# 设置执行权限（POSIX）
if os.name == "posix":
    script = base / "run.sh"
    script.touch()
    script.chmod(script.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    print(f"run.sh 可执行: {bool(script.stat().st_mode & stat.S_IXUSR)}")

# ---- 相对路径 vs 绝对路径 ----
p = Path("/Users/moon/projects/data/file.txt")
print(p.relative_to("/Users/moon/projects"))  # data/file.txt
print(p.with_name("new_file.txt"))            # /Users/moon/projects/data/new_file.txt
print(p.with_suffix(".csv"))                  # /Users/moon/projects/data/file.csv

# ---- 区分文件与目录 ----
for item in base.rglob("*"):
    if item.is_file():
        print(f"📄 {item}")
    elif item.is_dir():
        print(f"📁 {item}")

# ---- 硬链接与符号链接 ----
original = Path("/tmp/original.txt")
original.write_text("hello")
link = Path("/tmp/link_to_original.txt")
if not link.exists():
    link.hardlink_to(original)  # 硬链接
    print(f"硬链接: {link} -> {original} (inode: {link.stat().st_ino})")

symlink = Path("/tmp/symlink_to_original.txt")
if not symlink.exists():
    symlink.symlink_to(original)  # 符号链接
    print(f"符号链接: {symlink.resolve()} -> {symlink}")

# 清理临时文件
original.unlink()
print(f"链接还存在: {link.exists()}")   # True（硬链接独立于原文件）
print(f"符号链接还存在: {symlink.exists()}")  # False
```

### 2.2 shutil 高阶操作

```python
# shutil_advanced.py — 高级文件操作
import shutil
import tempfile
from pathlib import Path

# ---- 创建临时目录 ----
tmp_dir = tempfile.mkdtemp(prefix="py_auto_")
tmp_path = Path(tmp_dir)
print(f"临时目录: {tmp_path}")

# 准备测试文件
(tmp_path / "src" / "subdir").mkdir(parents=True)
(tmp_path / "src" / "file1.txt").write_text("content1")
(tmp_path / "src" / "subdir" / "file2.txt").write_text("content2")

# ---- shutil.copytree — 复制目录树 ----
dest = tmp_path / "backup"
shutil.copytree(tmp_path / "src", dest, dirs_exist_ok=True)
print(f"已备份到: {dest}")

# ---- shutil.make_archive — 打包 ----
archive_path = shutil.make_archive(
    base_name=str(tmp_path / "archive"),
    format="gztar",           # 也支持 zip, bztar, xztar
    root_dir=str(tmp_path),
    base_dir="src",
)
print(f"压缩包: {archive_path}")

# ---- shutil.disk_usage — 磁盘使用 ----
usage = shutil.disk_usage("/")
print(f"磁盘使用 — 总量: {usage.total // (1024**3)}G, "
      f"已用: {usage.used // (1024**3)}G, "
      f"可用: {usage.free // (1024**3)}G")

# ---- shutil.which — 查找可执行文件 ----
git_path = shutil.which("git")
python_path = shutil.which("python3")
print(f"git: {git_path}")
print(f"python3: {python_path}")

# ---- 自定义忽略模式 ----
def ignore_specific(dirname: str, filenames: list[str]) -> set[str]:
    """copy_tree 时忽略 __pycache__ 和 .pyc 文件"""
    ignored = set()
    if "__pycache__" in filenames:
        ignored.add("__pycache__")
    ignored.update(f for f in filenames if f.endswith(".pyc"))
    return ignored

# 擦除临时文件
shutil.rmtree(tmp_path, ignore_errors=True)
```

### 2.3 文件监控 (watchdog)

```python
# file_watcher.py — 基于 watchdog 的文件监控
import time
import logging
from pathlib import Path
from typing import Callable

from watchdog.observers import Observer
from watchdog.events import (
    FileSystemEventHandler,
    FileCreatedEvent,
    FileModifiedEvent,
    FileDeletedEvent,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("watcher")


class ChangeHandler(FileSystemEventHandler):
    """自定义事件处理器"""

    def __init__(self, on_change: Callable = None):
        self.on_change = on_change

    def on_created(self, event):
        if not event.is_directory:
            logger.info(f"📄 文件创建: {event.src_path}")
            if self.on_change:
                self.on_change("created", event.src_path)

    def on_modified(self, event):
        if not event.is_directory:
            logger.info(f"✏️  文件修改: {event.src_path}")
            if self.on_change:
                self.on_change("modified", event.src_path)

    def on_deleted(self, event):
        if not event.is_directory:
            logger.info(f"🗑️  文件删除: {event.src_path}")
            if self.on_change:
                self.on_change("deleted", event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            logger.info(f"↪ 文件移动: {event.src_path} -> {event.dest_path}")
            if self.on_change:
                self.on_change("moved", {"src": event.src_path, "dest": event.dest_path})


class FileWatcher:
    """文件监控封装"""

    def __init__(self, watch_dir: str, patterns: list[str] | None = None):
        self.watch_dir = Path(watch_dir).resolve()
        self.patterns = patterns or ["*"]
        self.observer = Observer()
        self.handler = ChangeHandler()

    def start(self):
        """开始监控"""
        self.watch_dir.mkdir(parents=True, exist_ok=True)
        self.observer.schedule(
            self.handler,
            str(self.watch_dir),
            recursive=True,
        )
        self.observer.start()
        logger.info(f"开始监控目录: {self.watch_dir}")
        try:
            while self.observer.is_alive():
                self.observer.join(1)
        except KeyboardInterrupt:
            self.stop()

    def stop(self):
        self.observer.stop()
        self.observer.join()
        logger.info("监控已停止")


if __name__ == "__main__":
    watcher = FileWatcher("./watch_dir")
    watcher.start()
```

### 2.4 批量文件重命名

```python
# batch_rename.py — 批量重命名工具
import re
from pathlib import Path
from typing import Callable


def batch_rename(
    directory: str,
    rename_fn: Callable[[Path], str],
    pattern: str = "*",
    dry_run: bool = True,
) -> list[tuple[Path, Path]]:
    """
    批量重命名文件。
    
    Args:
        directory: 目标目录
        rename_fn: 接收 Path 对象，返回新文件名
        pattern: 匹配模式（通配符）
        dry_run: 仅预览不执行
    
    Returns:
        [(原始路径, 新路径)] 的列表
    """
    directory = Path(directory)
    changes = []

    for filepath in sorted(directory.glob(pattern)):
        if not filepath.is_file():
            continue

        new_name = rename_fn(filepath)
        new_path = filepath.with_name(new_name)

        if new_path == filepath:
            continue

        changes.append((filepath, new_path))

        if not dry_run:
            filepath.rename(new_path)
            print(f"  {filepath.name} -> {new_name}")
        else:
            print(f"  [模拟] {filepath.name} -> {new_name}")

    return changes


# ---- 使用示例 ----

# 1. 添加日期前缀
def add_date_prefix(filepath: Path) -> str:
    import datetime
    today = datetime.date.today().isoformat()
    return f"{today}_{filepath.name}"

# 2. 规范化文件名（空格替换、统一大小写）
def normalize_name(filepath: Path) -> str:
    name = filepath.stem
    name = name.strip()
    name = re.sub(r'\s+', '_', name)               # 空格 -> _
    name = re.sub(r'[^\w\-]', '', name)             # 去除特殊字符
    name = re.sub(r'_+', '_', name)                 # 合并连续下划线
    name = name.lower()
    return f"{name}{filepath.suffix}"

# 3. 数字序号重命名
def rename_with_index(filepath: Path, start: int = 1) -> str:
    """配合 functools.partial 使用"""
    index = rename_with_index.counter
    rename_with_index.counter += 1
    return f"{index:03d}{filepath.suffix}"

rename_with_index.counter = 1

# 4. 去除文件名中的日期
def remove_date(filepath: Path) -> str:
    name = filepath.stem
    name = re.sub(r'^\d{4}-\d{2}-\d{2}[-_]?', '', name)
    return f"{name}{filepath.suffix}"


if __name__ == "__main__":
    import functools

    test_dir = Path("/tmp/test_rename")
    test_dir.mkdir(exist_ok=True)
    for f in ["hello world.txt", "My Photo (2).jpg", "2025-01-15_report.pdf"]:
        (test_dir / f).write_text("test")

    print("=== 规范化名称 ===")
    batch_rename(str(test_dir), normalize_name, dry_run=False)

    print("\n=== 序号重命名 ===")
    batch_rename(str(test_dir),
                  functools.partial(rename_with_index, start=1),
                  dry_run=False)
```

---

## 3. 子进程管理

### 3.1 subprocess 进阶

```python
# subprocess_advanced.py — 子进程高阶管理
import asyncio
import shlex
import signal
import subprocess
import sys
import time
from typing import Optional


# ---- 安全的命令拼接 ----
def run_command(cmd: list[str], timeout: Optional[float] = None) -> subprocess.CompletedProcess:
    """
    安全执行命令，使用列表而非字符串避免 shell 注入。
    
    Args:
        cmd: 命令列表，如 ["ls", "-l", "/tmp"]
        timeout: 超时秒数
    """
    print(f"执行: {shlex.join(cmd)}")
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,  # 不自动抛异常，由调用方处理
        )
        return result
    except subprocess.TimeoutExpired:
        print(f"❌ 命令超时 ({timeout}s): {cmd}")
        raise
    except FileNotFoundError:
        print(f"❌ 命令不存在: {cmd[0]}")
        raise


# ---- 实时流式输出 ----
def stream_output(cmd: list[str]):
    """实时获取子进程输出（按行）"""
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    for line in process.stdout:
        print(f"[stdout] {line}", end="")
    process.wait()
    return process.returncode


# ---- 进程间通信：管道 ----
def pipe_commands(cmds: list[list[str]]) -> bytes:
    """
    管道连接多个命令，类似 shell 的 cmd1 | cmd2 | cmd3。
    
    示例: pipe_commands([["cat", "file.txt"], ["grep", "error"], ["wc", "-l"]])
    """
    processes = []
    prev_stdout = None

    for cmd in cmds:
        process = subprocess.Popen(
            cmd,
            stdin=prev_stdout,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        processes.append(process)
        prev_stdout = process.stdout

    # 等待所有进程完成
    final_output = prev_stdout.read() if prev_stdout else b""
    for proc in processes:
        proc.wait()

    return final_output


# ---- 超时与信号处理 ----
class TimeoutProcess:
    """带超时和信号处理的进程包装"""

    def __init__(self, cmd: list[str], timeout: float = 30):
        self.cmd = cmd
        self.timeout = timeout
        self.process: Optional[subprocess.Popen] = None

    def run(self) -> subprocess.CompletedProcess:
        self.process = subprocess.Popen(
            self.cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=lambda: signal.signal(signal.SIGTERM, signal.SIG_DFL)
            if sys.platform != "win32" else None,
        )
        try:
            stdout, stderr = self.process.communicate(timeout=self.timeout)
            return subprocess.CompletedProcess(
                self.cmd,
                self.process.returncode,
                stdout=stdout,
                stderr=stderr,
            )
        except subprocess.TimeoutExpired:
            print(f"⏰ 超时，终止进程 (PID: {self.process.pid})")
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                print(f"💀 强制杀死进程 (PID: {self.process.pid})")
                self.process.kill()
                self.process.wait()
            raise


# ---- 使用示例 ----
if __name__ == "__main__":
    # 基本执行
    result = run_command(["echo", "hello world"])
    print(f"返回码: {result.returncode}, 输出: {result.stdout.strip()}")

    # 管道命令
    output = pipe_commands([
        ["ls", "-la", "/tmp"],
        ["grep", ".",
        ["wc", "-l"],
    ])
    print(f"管道输出行数: {len(output.decode().strip().split(chr(10)))}")

    # 带超时的进程
    try:
        tp = TimeoutProcess(["sleep", "10"], timeout=3)
        tp.run()
    except subprocess.TimeoutExpired:
        print("捕获到超时异常，处理正常")
```

### 3.2 异步子进程 (asyncio)

```python
# async_subprocess.py — 异步子进程管理
import asyncio
import sys


async def run_async_cmd(cmd: list[str], timeout: float = 30) -> tuple[int, str, str]:
    """异步执行子进程"""
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(), timeout=timeout
        )
        return proc.returncode, stdout.decode(), stderr.decode()
    except asyncio.TimeoutError:
        proc.terminate()
        await proc.wait()
        raise


async def multi_ping(hosts: list[str], count: int = 3):
    """并发 ping 多个主机"""
    tasks = []
    for host in hosts:
        cmd = ["ping", "-c", str(count), host]
        tasks.append(run_async_cmd(cmd, timeout=10))

    # 并发执行
    results = await asyncio.gather(*tasks, return_exceptions=True)

    for host, result in zip(hosts, results):
        if isinstance(result, Exception):
            print(f"❌ {host}: {result}")
        else:
            code, stdout, _ = result
            if code == 0:
                print(f"✅ {host}: 可达")
            else:
                print(f"❌ {host}: 不可达 (code={code})")


if __name__ == "__main__":
    asyncio.run(multi_ping(["8.8.8.8", "1.1.1.1", "192.0.2.1"]))
```

### 3.3 进程池并发执行

```python
# process_pool.py — 进程池管理外部命令
import asyncio
import subprocess
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path


@dataclass
class CommandResult:
    cmd: list[str]
    returncode: int
    stdout: str
    stderr: str
    elapsed: float


def run_single(cmd: list[str], timeout: float = 60) -> CommandResult:
    """供进程池调用的函数（必须可 pickle）"""
    import time
    start = time.time()
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout
        )
        elapsed = time.time() - start
        return CommandResult(cmd, result.returncode, result.stdout, result.stderr, elapsed)
    except subprocess.TimeoutExpired:
        elapsed = time.time() - start
        return CommandResult(cmd, -1, "", f"Timeout ({timeout}s)", elapsed)
    except Exception as e:
        elapsed = time.time() - start
        return CommandResult(cmd, -1, "", str(e), elapsed)


class ParallelExecutor:
    """并行执行外部命令"""

    def __init__(self, max_workers: int = 4):
        self.max_workers = max_workers

    def run_all(self, commands: list[list[str]], timeout: float = 60) -> list[CommandResult]:
        """线程池方式（适合 I/O 密集型）"""
        with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
            futures = [executor.submit(run_single, cmd, timeout) for cmd in commands]
            return [f.result() for f in futures]

    def run_all_process(self, commands: list[list[str]], timeout: float = 60) -> list[CommandResult]:
        """进程池方式（适合 CPU 密集型）"""
        with ProcessPoolExecutor(max_workers=self.max_workers) as executor:
            futures = [executor.submit(run_single, cmd, timeout) for cmd in commands]
            return [f.result() for f in futures]


if __name__ == "__main__":
    executor = ParallelExecutor(max_workers=8)

    # 批量压缩文件
    files = list(Path("/tmp").glob("*.log"))
    commands = [["gzip", str(f)] for f in files[:10]]

    results = executor.run_all(commands)
    for r in results:
        status = "✅" if r.returncode == 0 else "❌"
        print(f"{status} {' '.join(r.cmd)} ({r.elapsed:.2f}s)")
```

---

## 4. 定时任务与调度

### 4.1 schedule 库

轻量级调度库，适合单进程内非持久化定时任务。

```python
# schedule_demo.py — 轻量级定时任务
import time
import logging
from datetime import datetime

import schedule
import pytz

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s [%(name)s] %(message)s")
logger = logging.getLogger("scheduler")


def job_backup():
    logger.info("🔄 执行数据库备份...")


def job_cleanup():
    logger.info("🧹 执行临时文件清理...")


def job_report():
    logger.info("📊 生成日报表...")


def job_with_args(name: str, count: int):
    logger.info(f"🎯 任务 {name} 执行第 {count} 次")


def job_once():
    """一次性任务，执行后自动取消"""
    logger.info("🏁 一次性任务完成")
    return schedule.CancelJob


# ---- 定时任务配置 ----
schedule.every(10).minutes.do(job_backup)               # 每 10 分钟
schedule.every().hour.do(job_cleanup)                   # 每小时
schedule.every().day.at("08:00").do(job_report)         # 每天 08:00
schedule.every().monday.at("09:30").do(job_report)      # 每周一 09:30

schedule.every(5).to(10).seconds.do(                    # 随机间隔 5-10 秒
    job_with_args, name="heartbeat", count=1
)

schedule.every().day.at("23:59").do(job_once)           # 执行一次

# ---- 进阶：标签与条件 ----
def conditional_job():
    """只在工作日执行"""
    if datetime.now().weekday() < 5:  # 周一到周五
        logger.info("工作日任务执行")
    else:
        logger.info("周末跳过")

schedule.every().day.at("12:00").do(conditional_job).tag("workdays")

# ---- 查询与取消 ----
def list_and_cancel():
    """列出并选择性取消任务"""
    all_jobs = schedule.get_jobs()
    logger.info(f"当前任务数: {len(all_jobs)}")

    # 按 tag 取消
    schedule.clear("workdays")
    logger.info("已取消 workdays 标签的任务")


# ---- 主循环（支持多线程） ----
import threading

def run_scheduler(interval: int = 1):
    """在后台线程运行调度器"""
    while True:
        schedule.run_pending()
        time.sleep(interval)

# 启动调度线程
scheduler_thread = threading.Thread(target=run_scheduler, daemon=True)
scheduler_thread.start()

logger.info("调度器已启动，运行 30 秒后退出...")
time.sleep(30)

# 清理
schedule.clear()
logger.info("调度器已停止")
```

### 4.2 APScheduler 进阶

APScheduler 功能远强于 `schedule`：支持持久化、多种触发器、任务存储后端。

```python
# apscheduler_demo.py — APScheduler 企业级调度
import logging
from datetime import datetime, timedelta
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.date import DateTrigger
from apscheduler.executors.pool import ThreadPoolExecutor, ProcessPoolExecutor
from apscheduler.jobstores.sqlalchemy import SQLAlchemyJobStore
from apscheduler.events import (
    EVENT_JOB_SUBMITTED,
    EVENT_JOB_EXECUTED,
    EVENT_JOB_ERROR,
    EVENT_JOB_MISSED,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s",
)
logger = logging.getLogger("apscheduler")


def task_send_email(to: str, subject: str):
    """发送邮件任务"""
    logger.info(f"📧 发送邮件: {subject} -> {to}")
    # 实际发送逻辑...


def task_generate_report(report_type: str = "daily"):
    """生成报表"""
    logger.info(f"📊 生成 {report_type} 报表")
    return f"{report_type}_report_{datetime.now():%Y%m%d}.pdf"


def task_clean_old_files(days: int = 30):
    """清理过期文件"""
    logger.info(f"🗑️ 清理 {days} 天前的文件")
    count = 0
    for f in Path("/tmp").glob("*.tmp"):
        age = datetime.fromtimestamp(f.stat().st_mtime)
        if datetime.now() - age > timedelta(days=days):
            f.unlink()
            count += 1
    logger.info(f"  已清理 {count} 个文件")


def my_listener(event):
    """任务事件监听器"""
    if event.exception:
        logger.error(f"❌ 任务 {event.job_id} 失败: {event.exception}")
    elif not event.retval:
        logger.info(f"✅ 任务 {event.job_id} 完成")
    else:
        logger.info(f"✅ 任务 {event.job_id} 完成, 返回值: {event.retval}")


# ---- 配置调度器 ----
jobstores = {
    "default": SQLAlchemyJobStore(url="sqlite:///jobs.sqlite"),
}

executors = {
    "default": ThreadPoolExecutor(10),
    "processpool": ProcessPoolExecutor(4),
}

job_defaults = {
    "coalesce": True,        # 合并错过的任务
    "max_instances": 1,      # 同一任务最大并发实例
    "misfire_grace_time": 300,  # 错过执行后的宽容时间(秒)
}

scheduler = BackgroundScheduler(
    jobstores=jobstores,
    executors=executors,
    job_defaults=job_defaults,
    timezone="Asia/Shanghai",
)

scheduler.add_listener(my_listener, EVENT_JOB_EXECUTED | EVENT_JOB_ERROR | EVENT_JOB_MISSED)


# ---- 添加任务 ----

# 1. Cron 风格（类似 Linux crontab）
scheduler.add_job(
    task_generate_report,
    CronTrigger(hour=8, minute=0, day_of_week="mon-fri"),
    args=["weekly"],
    id="weekly_report",
    name="周报生成",
    replace_existing=True,
)

# 2. 固定间隔
scheduler.add_job(
    task_clean_old_files,
    IntervalTrigger(days=1),
    kwargs={"days": 30},
    id="daily_cleanup",
    name="每日清理",
)

# 3. 一次性任务（30 秒后执行）
scheduler.add_job(
    task_send_email,
    DateTrigger(run_date=datetime.now() + timedelta(seconds=30)),
    kwargs={"to": "admin@example.com", "subject": "系统启动通知"},
    id="startup_notify",
)

# 4. 数据库持久化：即使重启也能恢复任务
scheduler.start()
logger.info("APScheduler 已启动, 任务已持久化到 SQLite")

try:
    import time
    time.sleep(60)
finally:
    scheduler.shutdown(wait=False)
```

### 4.3 与系统 Crontab 集成

```python
# crontab_manager.py — 管理 Linux crontab
import subprocess
import shlex
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CronEntry:
    """Crontab 条目"""
    schedule: str          # "0 8 * * 1-5"
    command: str           # "/usr/bin/python3 /path/to/script.py"
    comment: Optional[str] = None
    disabled: bool = False

    def render(self) -> str:
        lines = []
        if self.comment:
            lines.append(f"# {self.comment}")
        if self.disabled:
            lines.append(f"# {self.schedule} {self.command}")
        else:
            lines.append(f"{self.schedule} {self.command}")
        return "\n".join(lines) + "\n"


class CrontabManager:
    """系统 crontab 管理器"""

    def __init__(self, user: Optional[str] = None):
        self.user = user
        self._entries: list[CronEntry] = []

    def _run_crontab(self, cmd: list[str]) -> str:
        """执行 crontab 命令"""
        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=10
            )
            return result.stdout
        except subprocess.TimeoutExpired:
            raise RuntimeError("crontab 命令超时")

    def load(self):
        """加载当前 crontab"""
        cmd = ["crontab", "-l"]
        if self.user:
            cmd = ["sudo", "-u", self.user] + cmd
        try:
            output = self._run_crontab(cmd)
            # 简化的解析逻辑
            for line in output.splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                self._entries.append(CronEntry(
                    schedule=" ".join(line.split()[:5]),
                    command=" ".join(line.split()[5:]),
                ))
        except RuntimeError:
            pass  # 没有 crontab
        return self

    def add(self, entry: CronEntry):
        self._entries.append(entry)
        return self

    def remove(self, command_pattern: str):
        """按命令匹配删除条目"""
        self._entries = [
            e for e in self._entries
            if command_pattern not in e.command
        ]
        return self

    def save(self):
        """写回 crontab"""
        content = "# Managed by CrontabManager\n"
        content += f"# Updated: {subprocess.run(['date'], capture_output=True, text=True).stdout.strip()}\n\n"
        for entry in self._entries:
            content += entry.render()

        proc = subprocess.Popen(
            ["crontab", "-"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        _, stderr = proc.communicate(input=content.encode())
        if proc.returncode != 0:
            raise RuntimeError(f"写入 crontab 失败: {stderr.decode()}")
        print(f"✅ 已写入 {len(self._entries)} 条 crontab 规则")

    def list(self) -> list[CronEntry]:
        return self._entries.copy()


# 使用示例
if __name__ == "__main__":
    manager = CrontabManager()
    manager.load()

    # 添加新任务
    manager.add(CronEntry(
        schedule="0 3 * * *",
        command="/usr/bin/python3 /opt/backup.py --full",
        comment="每日凌晨 3 点全量备份",
    ))
    manager.add(CronEntry(
        schedule="*/5 * * * *",
        command="/usr/bin/python3 /opt/health_check.py",
        comment="每 5 分钟健康检查",
    ))

    # 删除已有任务
    manager.remove("old_script.py")

    # 保存
    manager.save()

    for entry in manager.list():
        print(f"  {entry.schedule} {entry.command}")
```

### 4.4 分布式调度思路

当任务量超出单机处理能力时，需要引入分布式调度：

- **Celery + Beat**：最成熟的 Python 分布式任务队列，Redis/RabbitMQ 作为 Broker
- **Airflow**：DAG 任务编排，适合 ETL 和数据管道
- **APScheduler + Redis**：配合 RedisJobStore 实现多进程任务去重
- **Kubernetes CronJob**：云原生场景下的分布式定时任务

```python
# 分布式调度的核心模式：基于 Redis 的分布式锁
import hashlib
import time
import uuid

try:
    import redis
except ImportError:
    redis = None


class DistributedSchedule:
    """基于 Redis 的分布式调度协调器"""

    def __init__(self, redis_url: str = "redis://localhost:6379/0"):
        if redis is None:
            raise ImportError("需要安装 redis 库: pip install redis")
        self.client = redis.from_url(redis_url)
        self.instance_id = str(uuid.uuid4())[:8]

    def acquire_lock(self, task_id: str, ttl: int = 300) -> bool:
        """尝试获取任务锁，成功返回 True"""
        lock_key = f"task_lock:{task_id}"
        acquired = self.client.setnx(lock_key, self.instance_id)
        if acquired:
            self.client.expire(lock_key, ttl)
            return True
        return False

    def release_lock(self, task_id: str):
        """释放任务锁（只释放自己的）"""
        lock_key = f"task_lock:{task_id}"
        lock_val = self.client.get(lock_key)
        if lock_val and lock_val.decode() == self.instance_id:
            self.client.delete(lock_key)

    def should_run(self, task_id: str, interval: int = 3600) -> bool:
        """
        检查任务是否需要执行（基于时间窗口）。
        所有 worker 共享此检查，确保同一时间段只执行一次。
        """
        key = f"task_last_run:{task_id}"
        last_run = self.client.get(key)
        now = time.time()

        if last_run is None:
            # 从未执行过，尝试锁
            if self.acquire_lock(f"init:{task_id}", ttl=10):
                self.client.setex(key, interval, int(now))
                return True
            return False

        last_run_time = float(last_run)
        if now - last_run_time >= interval:
            if self.acquire_lock(task_id, ttl=30):
                self.client.setex(key, interval, int(now))
                self.release_lock(task_id)
                return True
        return False

    def task_done(self, task_id: str):
        """标记任务完成"""
        self.release_lock(task_id)


# 使用模式
ds = DistributedSchedule()

if ds.should_run("health_check", interval=300):
    try:
        print("执行健康检查...")
        # 实际任务逻辑
    finally:
        ds.task_done("health_check")
```

---

## 5. 日志与监控

### 5.1 logging 模块高级配置

```python
# logging_advanced.py — 企业级日志配置
import json
import logging
import logging.config
import logging.handlers
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Optional


# ---- 方案 A：代码配置（推荐用于库） ----
def setup_logging(
    app_name: str = "myapp",
    log_dir: str = "./logs",
    level: str = "INFO",
    json_format: bool = False,
) -> logging.Logger:
    """配置企业级日志系统"""
    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger(app_name)
    logger.setLevel(getattr(logging, level.upper()))

    # ---- 格式器 ----
    console_format = logging.Formatter(
        "%(asctime)s [%(levelname)-7s] %(name)s:%(lineno)d — %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    file_format = logging.Formatter(
        "%(asctime)s [%(levelname)-7s] %(name)s:%(lineno)d — %(message)s "
        "[%(process)d|%(thread)d] %(pathname)s:%(funcName)s",
    )

    # ---- 控制台输出 ----
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(console_format)
    console_handler.setLevel(logging.DEBUG)  # 控制台级别独立
    logger.addHandler(console_handler)

    # ---- 文件轮转 ----
    file_handler = logging.handlers.RotatingFileHandler(
        filename=log_path / f"{app_name}.log",
        maxBytes=10 * 1024 * 1024,  # 10MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(file_format)
    file_handler.setLevel(logging.DEBUG)
    logger.addHandler(file_handler)

    # ---- 错误专用文件 ----
    error_handler = logging.handlers.RotatingFileHandler(
        filename=log_path / f"{app_name}_error.log",
        maxBytes=50 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    error_handler.setFormatter(file_format)
    error_handler.setLevel(logging.ERROR)
    logger.addHandler(error_handler)

    # ---- 时间轮转（按天） ----
    timed_handler = logging.handlers.TimedRotatingFileHandler(
        filename=log_path / f"{app_name}_daily.log",
        when="midnight",
        interval=1,
        backupCount=30,   # 保留 30 天
        encoding="utf-8",
    )
    timed_handler.setFormatter(file_format)
    timed_handler.setLevel(logging.INFO)
    logger.addHandler(timed_handler)

    return logger


# ---- 方案 B：dictConfig 配置（推荐用于应用） ----
LOGGING_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "standard": {
            "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        },
        "json": {
            "class": "pythonjsonlogger.jsonlogger.JsonFormatter",
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "level": "DEBUG",
            "formatter": "standard",
            "stream": "ext://sys.stdout",
        },
        "file_rotating": {
            "class": "logging.handlers.RotatingFileHandler",
            "level": "INFO",
            "formatter": "standard",
            "filename": "logs/app.log",
            "maxBytes": 10485760,
            "backupCount": 5,
            "encoding": "utf8",
        },
    },
    "loggers": {
        "myapp": {
            "handlers": ["console", "file_rotating"],
            "level": "INFO",
            "propagate": False,
        },
        "myapp.worker": {
            "handlers": ["console"],
            "level": "DEBUG",
            "propagate": True,  # 向上传播到 myapp
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "WARNING",
    },
}

# logging.config.dictConfig(LOGGING_CONFIG)

# ---- 使用示例 ----
logger = setup_logging()

logger.debug("调试信息（仅文件和 console debug 级别）")
logger.info("服务启动完成")
logger.warning("磁盘使用率超过 80%%")
logger.error("数据库连接超时", exc_info=True)

try:
    1 / 0
except ZeroDivisionError:
    logger.exception("捕获到异常信息")  # 自动包含 traceback
```

### 5.2 结构化日志 (structlog)

```python
# structlog_demo.py — 结构化日志
import sys
from datetime import datetime

import structlog
from structlog.processors import JSONRenderer, TimeStamper

# ---- 配置 structlog ----
structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        # 添加时间戳
        TimeStamper(fmt="iso", utc=True),
        # 添加调用者信息
        structlog.processors.CallsiteParameterAdder(
            parameters=[
                structlog.processors.CallsiteParameter.FILENAME,
                structlog.processors.CallsiteParameter.FUNC_NAME,
                structlog.processors.CallsiteParameter.LINENO,
            ],
        ),
        # 渲染器：开发环境用彩色控制台，生产用 JSON
        structlog.dev.ConsoleRenderer()
        if sys.stderr.isatty()
        else JSONRenderer(indent=None),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    cache_logger_on_first_use=True,
)

logger = structlog.get_logger()

# ---- 使用 ----
logger.info("服务启动", service="api", port=8080, env="production")

try:
    result = 100 / 0
except ZeroDivisionError as e:
    logger.error("计算错误", error=str(e), input_value=100, exc_info=True)

# ---- 上下文绑定 ----
logger = logger.bind(request_id="req-12345")
logger.info("处理请求开始", path="/api/v1/users")
logger.info("处理请求完成", status=200, duration_ms=45.2)
```

**为什么使用结构化日志？**

传统日志是字符串，难以被机器解析和搜索：

```
2025-06-12 08:00:00 INFO 服务启动 port=8080 env=production
```

结构化日志输出是键值对或 JSON：

```json
{"event":"服务启动","port":8080,"env":"production","timestamp":"2025-06-12T00:00:00Z","level":"info"}
```

这使得 Splunk、ELK、Loki 等日志系统可以直接索引和查询。

### 5.3 日志监控告警集成

```python
# log_monitor.py — 日志监控与告警
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable, Optional


@dataclass
class AlertRule:
    """告警规则"""
    name: str
    pattern: str            # 正则表达式匹配日志
    cooldown: int = 300     # 冷却时间(秒)，避免重复告警
    min_count: int = 1      # 触发告警的最少匹配次数
    window: int = 60        # 计数窗口(秒)
    severity: str = "warning"
    last_alert: float = 0.0  # 上次告警时间戳


@dataclass
class LogMonitor:
    """日志文件监控器"""
    log_path: Path
    rules: list[AlertRule] = field(default_factory=list)
    alert_handlers: list[Callable] = field(default_factory=list)

    # 窗口计数
    _counts: dict = field(default_factory=lambda: defaultdict(int))
    _window_start: float = field(default_factory=time.time)

    def add_rule(self, rule: AlertRule) -> "LogMonitor":
        self.rules.append(rule)
        return self

    def on_alert(self, handler: Callable) -> "LogMonitor":
        """注册告警处理器（发邮件、钉钉、Slack 等）"""
        self.alert_handlers.append(handler)
        return self

    def _check_window(self):
        """重置超期的计数窗口"""
        now = time.time()
        if now - self._window_start > 60:
            self._counts.clear()
            self._window_start = now

    def _trigger_alert(self, rule: AlertRule, line: str):
        """触发告警"""
        now = time.time()
        if now - rule.last_alert < rule.cooldown:
            return  # 冷却中

        rule.last_alert = now
        alert_msg = (
            f"[{rule.severity.upper()}] {rule.name}: "
            f"匹配到日志 '{rule.pattern}' — {line.strip()}"
        )
        print(f"🚨 {alert_msg}")

        for handler in self.alert_handlers:
            try:
                handler(rule, alert_msg, line)
            except Exception as e:
                print(f"告警处理器异常: {e}")

    def start(self, follow: bool = True):
        """启动监控（类似 tail -f）"""
        if not self.log_path.exists():
            raise FileNotFoundError(f"日志文件不存在: {self.log_path}")

        with open(self.log_path, "r", encoding="utf-8") as f:
            # 如果不是 follow 模式，直接读完
            if not follow:
                self._process_lines(f.readlines())
                return

            # tail -f 模式
            f.seek(0, 2)  # 移到文件末尾
            while True:
                line = f.readline()
                if line:
                    self._process_lines([line])
                else:
                    time.sleep(0.5)

    def _process_lines(self, lines: list[str]):
        self._check_window()
        for line in lines:
            line = line.rstrip("\n")
            for rule in self.rules:
                if re.search(rule.pattern, line):
                    self._counts[rule.name] += 1
                    count = self._counts[rule.name]
                    if count >= rule.min_count:
                        self._trigger_alert(rule, line)
                    break  # 一行只匹配第一个规则


# ---- 告警处理器 ----
def send_dingtalk(rule: AlertRule, message: str, raw_line: str):
    """发送钉钉告警（示例）"""
    # import requests
    # requests.post(
    #     "https://oapi.dingtalk.com/robot/send?access_token=xxx",
    #     json={"msgtype": "text", "text": {"content": message}},
    # )
    print(f"   -> 发送钉钉告警: {message[:60]}...")


def send_slack(rule: AlertRule, message: str, raw_line: str):
    """发送 Slack 告警（示例）"""
    pass


# ---- 使用 ----
if __name__ == "__main__":
    monitor = LogMonitor(
        log_path=Path("/var/log/myapp/error.log"),
        rules=[
            AlertRule(
                name="数据库连接失败",
                pattern=r"database connection.*(failed|refused|timeout)",
                severity="critical",
                cooldown=600,
                min_count=3,
            ),
            AlertRule(
                name="HTTP 500 错误",
                pattern=r"HTTP.*500",
                severity="error",
                min_count=5,
                window=120,
            ),
        ],
    )
    monitor.on_alert(send_dingtalk)
    # monitor.start(follow=True)
```

---

## 6. 实战：运维自动化脚本

### 6.1 服务器健康检查

```python
# health_check.py — 综合服务器健康检查
"""
使用方式:
  python health_check.py
  python health_check.py --json --output report.json
  python health_check.py --check disk,memory,cpu
"""
import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional


@dataclass
class HealthReport:
    timestamp: str
    hostname: str
    platform: str
    uptime: Optional[str] = None
    cpu_percent: Optional[float] = None
    cpu_load_avg: Optional[tuple] = None
    memory_total_gb: Optional[float] = None
    memory_used_gb: Optional[float] = None
    memory_percent: Optional[float] = None
    disk_usage: list = None
    network_io: dict = None
    top_processes: list = None
    services_running: dict = None
    errors: list = None

    def to_dict(self) -> dict:
        return asdict(self)

    def passed(self, thresholds: dict = None) -> bool:
        """检查各项是否在阈值范围内"""
        thresholds = thresholds or {
            "cpu_percent": 90,
            "memory_percent": 90,
            "disk_percent": 90,
        }
        if self.cpu_percent and self.cpu_percent > thresholds["cpu_percent"]:
            return False
        if self.memory_percent and self.memory_percent > thresholds["memory_percent"]:
            return False
        if self.disk_usage:
            for disk in self.disk_usage:
                if disk["percent"] > thresholds["disk_percent"]:
                    return False
        return True


class HealthChecker:
    """系统健康检查器"""

    def __init__(self, services: list[str] = None):
        self.services = services or ["nginx", "mysql", "redis"]

    def run(self) -> HealthReport:
        report = HealthReport(
            timestamp=datetime.now().isoformat(),
            hostname=platform.node(),
            platform=f"{platform.system()} {platform.release()}",
            errors=[],
        )

        try:
            report.cpu_percent = self._get_cpu()
            report.cpu_load_avg = self._get_load_avg()
            report.memory_total_gb, report.memory_used_gb, report.memory_percent = \
                self._get_memory()
            report.disk_usage = self._get_disk()
            report.uptime = self._get_uptime()
            report.top_processes = self._get_top_processes()
            report.services_running = self._check_services()
            report.network_io = self._get_network_io()
        except Exception as e:
            report.errors.append(str(e))

        return report

    def _run_cmd(self, cmd: list[str]) -> str:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        return result.stdout.strip()

    def _get_cpu(self) -> float:
        if sys.platform == "darwin":
            out = self._run_cmd(["ps", "-A", "-o", "%cpu"])
            lines = out.split("\n")[1:]
            cpus = [float(x) for x in lines if x.strip()]
            return sum(cpus) / len(cpus) if cpus else 0.0
        else:
            out = self._run_cmd(["top", "-bn1"])
            for line in out.split("\n"):
                if "Cpu(s)" in line or "%Cpu(s)" in line:
                    parts = line.split(",")
                    return float(parts[0].split()[-2].replace("us", "").strip())
            return 0.0

    def _get_load_avg(self) -> tuple:
        try:
            avg = os.getloadavg()
            return avg
        except AttributeError:
            return None

    def _get_memory(self) -> tuple[float, float, float]:
        if sys.platform == "darwin":
            out = self._run_cmd(["vm_stat"])
            mem = self._run_cmd(["sysctl", "hw.memsize"])
            total = int(mem.split()[-1]) / (1024 ** 3)
            # 简化估算
            return round(total, 1), 0.0, 0.0

        out = self._run_cmd(["free", "-b"])
        for line in out.split("\n"):
            if line.startswith("Mem:"):
                parts = line.split()
                total = int(parts[1]) / (1024 ** 3)
                used = int(parts[2]) / (1024 ** 3)
                percent = (used / total) * 100
                return round(total, 1), round(used, 1), round(percent, 1)
        return 0.0, 0.0, 0.0

    def _get_disk(self) -> list[dict]:
        usage = shutil.disk_usage("/")
        return [{
            "mount": "/",
            "total_gb": round(usage.total / (1024 ** 3), 1),
            "used_gb": round(usage.used / (1024 ** 3), 1),
            "free_gb": round(usage.free / (1024 ** 3), 1),
            "percent": round(usage.used / usage.total * 100, 1),
        }]

    def _get_uptime(self) -> str:
        if sys.platform == "darwin":
            out = self._run_cmd(["sysctl", "-n", "kern.boottime"])
            # 简略返回
            return out[:60]
        out = self._run_cmd(["uptime", "-p"])
        return out

    def _get_top_processes(self, n: int = 5) -> list[dict]:
        # 使用 ps 获取 CPU 占用最高的进程
        out = self._run_cmd(
            ["ps", "aux", "--sort=-%cpu"] if sys.platform != "darwin"
            else ["ps", "aux"]
        )
        lines = out.split("\n")[1:n + 1]
        processes = []
        for line in lines:
            parts = line.split(None, 10)
            if len(parts) >= 11:
                processes.append({
                    "user": parts[0],
                    "cpu": parts[2],
                    "mem": parts[3],
                    "command": parts[10][:60],
                })
        return processes

    def _check_services(self) -> dict:
        status = {}
        for svc in self.services:
            cmd = ["systemctl", "is-active", svc] if sys.platform == "linux" \
                else ["pgrep", "-x", svc]
            try:
                result = subprocess.run(cmd, capture_output=True, timeout=5)
                status[svc] = result.returncode == 0
            except Exception:
                status[svc] = False
        return status

    def _get_network_io(self) -> dict:
        if sys.platform == "darwin":
            out = self._run_cmd(["netstat", "-ib"])
            return {"raw": out[:200]}
        out = self._run_cmd(["cat", "/proc/net/dev"])
        interfaces = {}
        for line in out.split("\n")[2:]:
            parts = line.split()
            if len(parts) >= 10:
                name = parts[0].rstrip(":")
                interfaces[name] = {
                    "rx_bytes": int(parts[1]),
                    "tx_bytes": int(parts[9]),
                }
        return interfaces


def main():
    parser = argparse.ArgumentParser(description="服务器健康检查")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    parser.add_argument("--output", "-o", type=str, help="输出文件路径")
    parser.add_argument("--services", "-s", type=str, default="nginx,mysql,redis",
                        help="要检查的服务列表(逗号分隔)")
    args = parser.parse_args()

    checker = HealthChecker(services=args.services.split(","))
    report = checker.run()

    if args.json or args.output:
        data = report.to_dict()
        if args.output:
            Path(args.output).write_text(
                json.dumps(data, indent=2, ensure_ascii=False)
            )
            print(f"已写入报告: {args.output}")
        else:
            print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        # 人可读输出
        print(f"📋 健康检查报告 — {report.hostname}")
        print(f"⏰ {report.timestamp}")
        print(f"🖥️  {report.platform}")
        print(f"  Uptime: {report.uptime}")
        if report.cpu_percent is not None:
            print(f"  CPU: {report.cpu_percent:.1f}%")
        if report.cpu_load_avg:
            print(f"  Load: {report.cpu_load_avg[0]:.2f} {report.cpu_load_avg[1]:.2f} {report.cpu_load_avg[2]:.2f}")
        if report.memory_percent:
            print(f"  Memory: {report.memory_used_gb:.1f}/{report.memory_total_gb:.1f}GB ({report.memory_percent:.1f}%)")
        if report.disk_usage:
            for d in report.disk_usage:
                print(f"  Disk {d['mount']}: {d['used_gb']:.1f}/{d['total_gb']:.1f}GB ({d['percent']:.1f}%)")
        if report.services_running:
            for svc, running in report.services_running.items():
                icon = "🟢" if running else "🔴"
                print(f"  {icon} {svc}: {'运行中' if running else '已停止'}")
        overall = "✅ 通过" if report.passed() else "❌ 异常"
        print(f"\n总体状态: {overall}")


if __name__ == "__main__":
    main()
```

### 6.2 日志分析脚本

```python
# log_analyzer.py — 高效的日志分析工具
"""
使用方式:
  python log_analyzer.py access.log --top-ips 10
  python log_analyzer.py error.log --error-codes
  python log_analyzer.py *.log --stats --output result.json
"""
import argparse
import gzip
import json
import re
import sys
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Generator, Optional


class LogAnalyzer:
    """通用日志分析器"""

    COMMON_PATTERNS = {
        "apache": re.compile(
            r'(?P<ip>\S+)\s+\S+\s+\S+\s+'
            r'\[(?P<time>[^\]]+)\]\s+'
            r'"(?P<method>\S+)\s+(?P<path>\S+)\s+\S+"\s+'
            r'(?P<status>\d+)\s+(?P<size>\S+)'
        ),
        "nginx": re.compile(
            r'(?P<ip>\S+)\s+-\s+-\s+'
            r'\[(?P<time>[^\]]+)\]\s+'
            r'"(?P<method>\S+)\s+(?P<path>\S+)\s+\S+"\s+'
            r'(?P<status>\d+)\s+(?P<size>\S+)'
        ),
        "python": re.compile(
            r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}\s+'
            r'\[(?P<level>\w+)\]\s+'
            r'(?P<message>.*)'
        ),
    }

    def __init__(self, time_format: str = "apache"):
        self.pattern = self.COMMON_PATTERNS.get(time_format)
        self.stats = defaultdict(int)
        self.top_errors = Counter()
        self.status_codes = Counter()
        self.ip_requests = Counter()

    def feed(self, line: str):
        """处理单行日志"""
        match = self.pattern.search(line) if self.pattern else None

        if self.pattern and not match:
            self.stats["unmatched"] += 1
            return

        self.stats["total"] += 1

        if match:
            data = match.groupdict()
            if "status" in data:
                status = data["status"]
                self.status_codes[status] += 1
                if status.startswith("5"):
                    self.top_errors[data.get("path", "")] += 1
            if "ip" in data:
                self.ip_requests[data["ip"]] += 1
            if "level" in data:
                self.top_errors[data["level"]] += 1

    def summarize(self) -> dict:
        """生成摘要统计"""
        total = self.stats.get("total", 0)
        return {
            "total_lines": total,
            "status_codes": dict(self.status_codes.most_common()),
            "error_rate": round(
                sum(v for k, v in self.status_codes.items() if k.startswith("5")) / total * 100, 2
            ) if total > 0 else 0,
            "unique_ips": len(self.ip_requests),
            "top_ips": self.ip_requests.most_common(10),
            "top_errors": self.top_errors.most_common(10),
            "unmatched": self.stats.get("unmatched", 0),
        }


def tail_file(filepath: Path, n: int = 1000) -> list[str]:
    """高效读取文件末尾 N 行"""
    with open(filepath, "rb") as f:
        f.seek(0, 2)
        file_size = f.tell()
        lines = []
        buffer = b""

        chunk_size = min(file_size, 4096)
        while len(lines) <= n and file_size > 0:
            read_size = min(chunk_size, file_size)
            f.seek(file_size - read_size)
            chunk = f.read(read_size)
            buffer = chunk + buffer
            file_size -= read_size
            lines = buffer.decode("utf-8", errors="replace").splitlines()

        return lines[-n:]


def analyze_file(filepath: Path, time_format: str = "apache") -> dict:
    """分析单个日志文件"""
    analyzer = LogAnalyzer(time_format)
    try:
        content = filepath.read_text(encoding="utf-8", errors="replace")
    except (MemoryError, UnicodeDecodeError):
        # 大文件使用逐行读取
        with filepath.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                analyzer.feed(line)
    else:
        for line in content.splitlines():
            analyzer.feed(line)

    return analyzer.summarize()


def analyze_parallel(file_pattern: str, time_format: str = "apache",
                     max_workers: int = 4) -> list[dict]:
    """并行分析多个日志文件"""
    files = list(Path().glob(file_pattern))
    if not files:
        print(f"未找到匹配 {file_pattern} 的文件")
        return []

    results = []
    with ProcessPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(analyze_file, f, time_format): f
            for f in files
        }
        for future in as_completed(futures):
            f = futures[future]
            try:
                result = future.result()
                results.append({"file": f.name, "analysis": result})
                print(f"✅ {f.name}: {result['total_lines']} 行")
            except Exception as e:
                print(f"❌ {f.name}: {e}")

    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="日志分析工具")
    parser.add_argument("files", nargs="+", help="日志文件路径或通配符")
    parser.add_argument("--format", default="apache",
                        choices=["apache", "nginx", "python"])
    parser.add_argument("--top-ips", type=int, default=0, help="显示 Top N IP")
    parser.add_argument("--stats", action="store_true", help="输出完整统计")
    parser.add_argument("--output", "-o", help="输出 JSON 到文件")
    args = parser.parse_args()

    all_results = []
    for file_pattern in args.files:
        results = analyze_parallel(file_pattern, args.format)
        all_results.extend(results)

    if args.output:
        Path(args.output).write_text(
            json.dumps(all_results, indent=2, ensure_ascii=False)
        )
        print(f"已保存分析结果到: {args.output}")
    else:
        print(json.dumps(all_results, indent=2, ensure_ascii=False))
```

### 6.3 批量部署脚本

```python
# deploy.py — 批量部署框架
"""
使用方式:
  python deploy.py --env staging deploy
  python deploy.py --env prod rollback --version 1.0.0
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Optional


@dataclass
class DeployConfig:
    """部署配置"""
    app_name: str = "myapp"
    src_dir: str = "./dist"
    deploy_base: str = "/srv/app"
    releases_dir: str = "releases"
    shared_dir: str = "shared"
    keep_releases: int = 5
    rsync_options: str = "-avz --delete"
    remote_host: str = ""
    remote_user: str = "deploy"
    pre_deploy_cmd: list[str] = field(default_factory=list)
    post_deploy_cmd: list[str] = field(default_factory=list)
    health_check_url: str = ""
    health_check_timeout: int = 30


class Deployer:
    """零停机部署工具（类似 Capistrano 风格）"""

    def __init__(self, config: DeployConfig):
        self.config = config
        self.release_name = datetime.now().strftime("%Y%m%d%H%M%S")
        self.release_path = None

    def _run_local(self, cmd: list[str], check: bool = True) -> str:
        """执行本地命令"""
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        if check and result.returncode != 0:
            raise RuntimeError(f"命令失败: {' '.join(cmd)}\n{result.stderr}")
        return result.stdout.strip()

    def _run_remote(self, cmd: str) -> str:
        """通过 SSH 执行远程命令"""
        host = self.config.remote_host
        user = self.config.remote_user
        full_cmd = ["ssh", f"{user}@{host}", cmd]
        return self._run_local(full_cmd)

    def _checksum_dir(self, path: Path) -> str:
        """计算目录校验和，用于增量判断"""
        sha = hashlib.sha256()
        for f in sorted(path.rglob("*")):
            if f.is_file():
                sha.update(f.read_bytes())
        return sha.hexdigest()[:12]

    def _build_release_path(self) -> str:
        base = self.config.deploy_base
        releases_dir = self.config.releases_dir
        return f"{base}/{releases_dir}/{self.release_name}"

    def build(self) -> str:
        """本地构建"""
        print("🔨 开始构建...")
        src = Path(self.config.src_dir)

        if not src.exists():
            raise FileNotFoundError(f"源代码目录不存在: {src}")

        # 运行构建命令
        for cmd in self.config.pre_deploy_cmd:
            self._run_local(cmd)

        checksum = self._checksum_dir(src)
        print(f"✅ 构建完成 (checksum: {checksum})")
        return checksum

    def deploy(self) -> bool:
        """执行部署"""
        if not self.config.remote_host:
            return self._deploy_local()
        return self._deploy_remote()

    def _deploy_local(self) -> bool:
        """本地部署"""
        base = Path(self.config.deploy_base)
        releases_dir = base / self.config.releases_dir
        shared_dir = base / self.config.shared_dir
        current_link = base / "current"

        # 创建目录结构
        releases_dir.mkdir(parents=True, exist_ok=True)
        shared_dir.mkdir(parents=True, exist_ok=True)

        # 复制源码到 release 目录
        self.release_path = releases_dir / self.release_name
        src = Path(self.config.src_dir)

        print(f"📦 部署到: {self.release_path}")
        start = time.time()

        # 使用 rsync 或 shutil
        if shutil.which("rsync"):
            self._run_local([
                "rsync", *self.config.rsync_options.split(),
                f"{src}/", f"{self.release_path}/",
            ])
        else:
            import shutil
            shutil.copytree(src, self.release_path, dirs_exist_ok=True)

        # 链接共享目录 (logs, config, uploads 等)
        for shared_item in ["log", "config", "uploads"]:
            shared_item_path = shared_dir / shared_item
            shared_item_path.mkdir(exist_ok=True)
            target = self.release_path / shared_item
            if not target.exists():
                target.symlink_to(shared_item_path, target_is_directory=True)

        # 运行后部署命令
        for cmd in self.config.post_deploy_cmd:
            self._run_local(cmd)

        # 切换软链
        temp_link = base / "next"
        if temp_link.exists():
            temp_link.unlink()
        temp_link.symlink_to(self.release_path, target_is_directory=True)
        temp_link.rename(current_link)

        elapsed = time.time() - start
        print(f"✅ 部署完成 ({elapsed:.1f}s)")

        # 清理旧版本
        self._cleanup(releases_dir)
        return True

    def _deploy_remote(self) -> bool:
        """远程部署"""
        release_path = self._build_release_path()

        # 1. 远程创建目录
        self._run_remote(f"mkdir -p {release_path}")

        # 2. rsync 推送代码
        src = self.config.src_dir
        print(f"📤 推送代码到 {self.config.remote_host}...")
        self._run_local([
            "rsync", *self.config.rsync_options.split(),
            "--rsync-path", "sudo rsync",
            f"{src}/",
            f"{self.config.remote_user}@{self.config.remote_host}:{release_path}/",
        ])

        # 3. 远程执行后部署命令
        for cmd in self.config.post_deploy_cmd:
            self._run_remote(f"cd {release_path} && {' '.join(cmd)}")

        # 4. 切换软链
        current = f"{self.config.deploy_base}/current"
        self._run_remote(
            f"ln -sfn {release_path} {current}"
        )

        # 5. 健康检查
        if self.config.health_check_url:
            self._health_check()

        print(f"✅ 远程部署完成: {release_path}")
        return True

    def _health_check(self) -> bool:
        """健康检查"""
        import urllib.request
        import urllib.error

        print(f"🏥 健康检查: {self.config.health_check_url}")
        start = time.time()

        while time.time() - start < self.config.health_check_timeout:
            try:
                resp = urllib.request.urlopen(
                    self.config.health_check_url, timeout=5
                )
                if resp.status == 200:
                    print("✅ 健康检查通过")
                    return True
            except urllib.error.URLError:
                time.sleep(2)

        print("❌ 健康检查失败")
        return False

    def _cleanup(self, releases_dir: Path):
        """清理旧版本"""
        releases = sorted([
            d for d in releases_dir.iterdir()
            if d.is_dir()
        ], key=lambda p: p.name)

        while len(releases) > self.config.keep_releases:
            old = releases.pop(0)
            print(f"🗑️  清理旧版本: {old.name}")
            self._run_local(["rm", "-rf", str(old)])

    def rollback(self, version: Optional[str] = None):
        """回滚到指定版本"""
        base = Path(self.config.deploy_base)
        releases_dir = base / self.config.releases_dir

        if version:
            target = releases_dir / version
            if not target.exists():
                raise FileNotFoundError(f"版本不存在: {version}")
        else:
            # 回滚到上一个版本
            releases = sorted([
                d for d in releases_dir.iterdir() if d.is_dir()
            ], key=lambda p: p.name)
            if len(releases) < 2:
                raise RuntimeError("没有可回滚的版本")
            target = releases[-2]

        current = base / "current"
        temp_link = base / "rollback"
        if temp_link.exists():
            temp_link.unlink()
        temp_link.symlink_to(target, target_is_directory=True)
        temp_link.rename(current)

        print(f"↩️  已回滚到: {target.name}")


def main():
    parser = argparse.ArgumentParser(description="批量部署工具")
    parser.add_argument("--env", "-e", choices=["dev", "staging", "prod"],
                        default="dev")
    parser.add_argument("--host", help="远程主机地址")
    parser.add_argument("--user", default="deploy", help="远程用户名")

    subparsers = parser.add_subparsers(dest="command", required=True)

    # deploy
    deploy_parser = subparsers.add_parser("deploy", help="执行部署")
    deploy_parser.add_argument("--dry-run", action="store_true")

    # rollback
    rollback_parser = subparsers.add_parser("rollback", help="回滚版本")
    rollback_parser.add_argument("--version", help="目标版本")

    args = parser.parse_args()

    # 环境配置
    env_configs = {
        "dev": {"host": "dev.example.com"},
        "staging": {"host": "staging.example.com"},
        "prod": {"host": "prod.example.com", "health_check_url": "https://example.com/health"},
    }

    config = DeployConfig(
        remote_host=args.host or env_configs[args.env].get("host", ""),
        remote_user=args.user,
        health_check_url=env_configs[args.env].get("health_check_url", ""),
        pre_deploy_cmd=[["npm", "run", "build"]],
        post_deploy_cmd=[["systemctl", "restart", "myapp"]],
    )

    deployer = Deployer(config)

    if args.command == "deploy":
        deployer.build()
        if args.dry_run:
            print("🔍 Dry-run 模式，未实际部署")
        else:
            deployer.deploy()
    elif args.command == "rollback":
        deployer.rollback(args.version)


if __name__ == "__main__":
    main()
```

---

## 总结

| 领域 | 核心工具/库 | 适用场景 |
|------|--------------|----------|
| CLI 开发 | argparse / Click / Typer | 构建命令行工具、运维工具 |
| 文件处理 | pathlib, shutil, watchdog | 批量文件操作、目录监控 |
| 子进程 | subprocess, asyncio.subprocess | 执行外部命令、进程编排 |
| 任务调度 | schedule / APScheduler / Crontab | 定时任务、周期作业 |
| 日志系统 | logging, structlog, loguru | 应用日志、结构化输出 |
| 监控告警 | 自定义 + 第三方集成 | 运维监控、异常通知 |

**下一步进阶方向：**

- **工具分发**：使用 `PyInstaller` / `Nuitka` 打包为单文件可执行程序
- **基础设施即代码**：结合 Ansible / Fabric 实现更强大的自动化
- **云平台集成**：使用 `boto3` (AWS) / `google-cloud-sdk` 实现云资源自动化
- **CI/CD 集成**：将自动化脚本融入 GitHub Actions / GitLab CI / Jenkins Pipeline
- **配置中心**：使用 Consul / etcd / ZooKeeper 实现分布式配置管理
