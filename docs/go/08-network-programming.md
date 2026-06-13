# 第八章：网络编程

> 适用于熟悉 Go 语法的开发者，侧重生产级网络编程实践。

---

## 8.1 TCP 服务器与客户端

Go 标准库 `net` 提供了基于 I/O 多路复用的 TCP 实现 —— goroutine-per-connection 模型简洁且高效。

### 8.1.1 TCP 服务器

```go
package main

import (
	"bufio"
	"fmt"
	"log"
	"net"
	"sync"
	"time"
)

func main() {
	addr := ":8080"
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("监听失败: %v", err)
	}
	defer listener.Close()
	log.Printf("TCP 服务器启动于 %s", addr)

	var wg sync.WaitGroup
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("接受连接失败: %v", err)
			continue
		}
		wg.Add(1)
		go handleConn(&wg, conn)
	}
	// 实际优雅关闭需要配合 signal.Notify
	// wg.Wait()
}

func handleConn(wg *sync.WaitGroup, conn net.Conn) {
	defer wg.Done()
	defer conn.Close()

	// 设置读写超时
	conn.SetDeadline(time.Now().Add(30 * time.Second))

	scanner := bufio.NewScanner(conn)
	for scanner.Scan() {
		text := scanner.Text()
		if text == "quit" {
			fmt.Fprintln(conn, "bye")
			return
		}
		// 模拟业务耗时后重置超时
		conn.SetDeadline(time.Now().Add(30 * time.Second))
		fmt.Fprintf(conn, "echo: %s\n", text)
	}
	if err := scanner.Err(); err != nil {
		log.Printf("读取错误: %v", err)
	}
}
```

### 8.1.2 TCP 客户端

```go
package main

import (
	"bufio"
	"fmt"
	"log"
	"net"
	"os"
	"time"
)

func main() {
	conn, err := net.DialTimeout("tcp", "localhost:8080", 5*time.Second)
	if err != nil {
		log.Fatalf("连接失败: %v", err)
	}
	defer conn.Close()

	// 从 stdin 读取并发往服务端
	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		for scanner.Scan() {
			fmt.Fprintln(conn, scanner.Text())
		}
	}()

	// 读取服务端响应
	scanner := bufio.NewScanner(conn)
	for scanner.Scan() {
		fmt.Printf("服务端: %s\n", scanner.Text())
	}
}
```

### 8.1.3 优雅关闭

使用 `net.Listener` 配合信号处理实现优雅退出：

```go
func serveGraceful(ctx context.Context, addr string) error {
	lc := net.ListenConfig{}
	listener, err := lc.Listen(ctx, "tcp", addr)
	if err != nil {
		return err
	}
	defer listener.Close()

	// 等待 context 取消后关闭监听器
	go func() {
		<-ctx.Done()
		listener.Close()
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			return err // ctx 取消后会返回错误，退出循环
		}
		go handleConn(nil, conn)
	}
}
```

### 8.1.4 粘包处理

TCP 是流协议，没有消息边界。常用方案：**长度前缀**（length-prefix）：

```go
// 发送：4 字节大端长度 + 数据
func sendMsg(conn net.Conn, data []byte) error {
	header := make([]byte, 4)
	binary.BigEndian.PutUint32(header, uint32(len(data)))
	_, err := conn.Write(header)
	if err != nil {
		return err
	}
	_, err = conn.Write(data)
	return err
}

// 接收：先读 4 字节长度，再读数据
func recvMsg(conn net.Conn) ([]byte, error) {
	header := make([]byte, 4)
	if _, err := io.ReadFull(conn, header); err != nil {
		return nil, err
	}
	size := binary.BigEndian.Uint32(header)
	data := make([]byte, size)
	if _, err := io.ReadFull(conn, data); err != nil {
		return nil, err
	}
	return data, nil
}
```

> 生产环境推荐使用成熟协议库（如 `bufio` + 自定义帧）或 protobuf 序列化配合长度前缀。

---

## 8.2 UDP 编程

UDP 是无连接、不可靠但低延迟的传输协议，适合音视频、DNS、服务发现等场景。

### 8.2.1 UDP 服务端

```go
package main

import (
	"fmt"
	"log"
	"net"
	"time"
)

func main() {
	addr := net.UDPAddr{Port: 9090, IP: net.ParseIP("0.0.0.0")}
	conn, err := net.ListenUDP("udp", &addr)
	if err != nil {
		log.Fatalf("监听 UDP 失败: %v", err)
	}
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(5 * time.Minute))

	buf := make([]byte, 65507) // UDP 最大理论载荷
	for {
		n, remoteAddr, err := conn.ReadFromUDP(buf)
		if err != nil {
			log.Printf("读取错误: %v", err)
			continue
		}
		msg := string(buf[:n])
		log.Printf("收到 %s: %s", remoteAddr, msg)

		// 回复
		reply := fmt.Sprintf("ack: %s", msg)
		conn.WriteToUDP([]byte(reply), remoteAddr)
	}
}
```

### 8.2.2 UDP 客户端

```go
func main() {
	conn, err := net.Dial("udp", "localhost:9090")
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	fmt.Fprint(conn, "hello udp")

	buf := make([]byte, 1024)
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	n, _ := conn.Read(buf)
	log.Printf("回复: %s", string(buf[:n]))
}
```

### 8.2.3 UDP 可靠传输思考

UDP 本身不保证有序、不重传。如需可靠传输，可参考以下思路：

| 机制 | 实现方式 |
|------|----------|
| 序列号 | 每个包携带递增 seq，接收方据此去重和排序 |
| ACK + 重传 | 发送方启动定时器，超时未收到 ack 则重传 |
| 流量控制 | 基于窗口或速率限制发送量 |
| FEC | 前向纠错编码，允许丢失部分包仍可恢复 |

> 生产选型：轻量场景用 `QUIC`(go 内置 `net/http` 支持)，自定义协议场景参考 `KCP` 或 `UDT`。

---

## 8.3 HTTP 客户端进阶

`http.Client` 是 Go HTTP 客户端的核心，合理配置能显著提升性能与可靠性。

### 8.3.1 超时配置

```go
type TimeoutConfig struct {
	ConnTimeout        time.Duration // 连接超时
	TLSHandshakeTimeout time.Duration
	RequestTimeout     time.Duration // 整体请求超时
	KeepAlive          time.Duration
}

func NewClient(cfg TimeoutConfig) *http.Client {
	return &http.Client{
		Timeout: cfg.RequestTimeout, // 包含整个请求生命周期
		Transport: &http.Transport{
			DialContext: (&net.Dialer{
				Timeout:   cfg.ConnTimeout,
				KeepAlive: cfg.KeepAlive,
			}).DialContext,
			TLSHandshakeTimeout:   cfg.TLSHandshakeTimeout,
			ResponseHeaderTimeout: 10 * time.Second,
			ExpectContinueTimeout: 1 * time.Second,
		},
	}
}
```

### 8.3.2 连接池与 Transport

```go
func NewPooledClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			MaxIdleConns:        100,            // 所有主机的最大空闲连接数
			MaxIdleConnsPerHost: 10,             // 每台主机的最大空闲连接数
			MaxConnsPerHost:     0,              // 每台主机最大连接数（0 不限制）
			IdleConnTimeout:     90 * time.Second, // 空闲连接超时关闭
			DisableCompression:  false,
		},
	}
}
```

### 8.3.3 自定义 TLS

```go
func NewTLSClient(caCert, clientCert, clientKey []byte) (*http.Client, error) {
	// 加载 CA 证书
	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(caCert) {
		return nil, fmt.Errorf("加载 CA 证书失败")
	}
	// 加载客户端证书
	cert, err := tls.X509KeyPair(clientCert, clientKey)
	if err != nil {
		return nil, err
	}
	return &http.Client{
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{
				RootCAs:      caPool,
				Certificates: []tls.Certificate{cert},
				MinVersion:   tls.VersionTLS12,
			},
		},
	}, nil
}
```

### 8.3.4 Cookie Jar

```go
func NewCookieClient() *http.Client {
	jar, _ := cookiejar.New(&cookiejar.Options{})
	return &http.Client{
		Jar: jar, // 自动管理 Cookie
	}
}
```

### 8.3.5 重定向控制

```go
client := &http.Client{
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 { // 最多 3 次重定向
			return http.ErrUseLastResponse
		}
		// 检查目标域名是否合法
		if req.URL.Host != "example.com" {
			return http.ErrUseLastResponse
		}
		return nil // 允许重定向
	},
}
```

### 8.3.6 请求重试

```go
func DoWithRetry(client *http.Client, req *http.Request, retries int) (*http.Response, error) {
	var body []byte
	if req.Body != nil {
		body, _ = io.ReadAll(req.Body)
		req.Body.Close()
	}
	for i := 0; i <= retries; i++ {
		if body != nil {
			req.Body = io.NopCloser(bytes.NewReader(body))
		}
		resp, err := client.Do(req)
		if err != nil {
			if i < retries {
				time.Sleep(time.Duration(1<<i) * 100 * time.Millisecond) // 指数退避
				continue
			}
			return nil, err
		}
		if resp.StatusCode >= 500 && i < retries {
			resp.Body.Close()
			time.Sleep(time.Duration(1<<i) * 100 * time.Millisecond)
			continue
		}
		return resp, nil
	}
	return nil, fmt.Errorf("重试耗尽")
}
```

---

## 8.4 WebSocket

WebSocket 提供全双工通信通道。Go 社区主流库是 `gorilla/websocket`（v1.x 已归档但稳定可用），新项目可考虑 `nhooyr.io/websocket`。

### 8.4.1 服务端实现

```go
import (
	"github.com/gorilla/websocket"
	"net/http"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // 生产环境需校验 Origin
	},
}

type WSServer struct {
	clients map[*websocket.Conn]bool
	mu      sync.RWMutex
}

func (s *WSServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	s.clients[conn] = true
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.clients, conn)
		s.mu.Unlock()
		conn.Close()
	}()

	// 启动 ping 协程保活
	done := make(chan struct{})
	defer close(done)

	go s.keepAlive(conn, done)

	// 读取消息
	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			break
		}
		// 广播给所有客户端（省略具体逻辑）
	}
}

func (s *WSServer) keepAlive(conn *websocket.Conn, done chan struct{}) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-done:
			return
		}
	}
}
```

### 8.4.2 客户端实现

```go
func wsClient() error {
	u := url.URL{Scheme: "ws", Host: "localhost:8080", Path: "/ws"}
	conn, _, err := websocket.DefaultDialer.Dial(u.String(), nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	// 处理服务端 ping
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// 读协程
	go func() {
		for {
			_, msg, err := conn.ReadMessage()
			if err != nil {
				return
			}
			log.Printf("收到: %s", msg)
		}
	}()

	// 写消息
	return conn.WriteMessage(websocket.TextMessage, []byte("hello"))
}
```

### 8.4.3 并发写安全

`gorilla/websocket` 不允许多个 goroutine 同时写同一个 conn，必须加锁：

```go
type SafeConn struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func (c *SafeConn) WriteJSON(v interface{}) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteJSON(v)
}

func (c *SafeConn) WriteMessage(msgType int, data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteMessage(msgType, data)
}
```

---

## 8.5 TLS 与安全

### 8.5.1 TLS 握手流程

```
ClientHello       →   (支持的 TLS 版本、加密套件)
ServerHello       ←   (选定版本、证书、密钥交换参数)
ClientKeyExchange →   (预主密钥，用公钥加密)
双方派生会话密钥
Finished          ⇄   (握手完成，后续加密通信)
```

### 8.5.2 自签名证书生成

```go
func generateSelfSignedCert() (certPEM, keyPEM []byte, err error) {
	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, nil, err
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName: "localhost",
		},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		DNSNames:              []string{"localhost", "127.0.0.1"},
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	derBytes, err := x509.CreateCertificate(rand.Reader, template, template, &privKey.PublicKey, privKey)
	if err != nil {
		return nil, nil, err
	}
	certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	privBytes, _ := x509.MarshalPKCS8PrivateKey(privKey)
	keyPEM = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privBytes})
	return
}
```

### 8.5.3 TLS 服务端

```go
func startTLSServer(certFile, keyFile string) error {
	config := &tls.Config{
		MinVersion:               tls.VersionTLS12,
		PreferServerCipherSuites: true,
		CurvePreferences:         []tls.CurveID{tls.X25519, tls.CurveP256},
	}
	listener, err := tls.Listen("tcp", ":8443", config)
	if err != nil {
		return err
	}
	return http.Serve(listener, nil)
}
```

### 8.5.4 mTLS 双向认证

```go
func mTLSServer(caCertFile, serverCertFile, serverKeyFile string) (*http.Server, error) {
	caCert, err := os.ReadFile(caCertFile)
	if err != nil {
		return nil, err
	}
	caPool := x509.NewCertPool()
	caPool.AppendCertsFromPEM(caCert)

	return &http.Server{
		TLSConfig: &tls.Config{
			ClientAuth: tls.RequireAndVerifyClientCert, // 要求客户端证书
			ClientCAs:  caPool,
			MinVersion: tls.VersionTLS12,
		},
	}, nil
}
```

---

## 8.6 反向代理

`net/http/httputil` 包提供了 `ReverseProxy`，可将请求转发到后端服务，原生支持修改请求/响应。

### 8.6.1 基础反向代理

```go
func singleBackend() {
	target, _ := url.Parse("http://localhost:3000")
	proxy := httputil.NewSingleHostReverseProxy(target)
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		r.Host = target.Host // 传递 Host 头
		proxy.ServeHTTP(w, r)
	})
	log.Fatal(http.ListenAndServe(":8080", nil))
}
```

### 8.6.2 自定义 Director

```go
func customDirector() {
	target := &url.URL{Scheme: "http", Host: "backend:3000"}
	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host
			req.URL.Path = singleJoiningSlash(target.Path, req.URL.Path)
			// 添加自定义头
			req.Header.Set("X-Forwarded-For", req.RemoteAddr)
			req.Header.Set("X-Proxy", "go-proxy/v1")
			// 重写路径
			if strings.HasPrefix(req.URL.Path, "/api") {
				req.URL.Path = strings.TrimPrefix(req.URL.Path, "/api")
			}
		},
	}
	http.ListenAndServe(":8080", proxy)
}
```

### 8.6.3 负载均衡

```go
type LoadBalancer struct {
	backends []*url.URL
	mu       sync.Mutex
	next     int
}

func (lb *LoadBalancer) Director(req *http.Request) {
	lb.mu.Lock()
	target := lb.backends[lb.next%len(lb.backends)]
	lb.next++
	lb.mu.Unlock()

	req.URL.Scheme = target.Scheme
	req.URL.Host = target.Host
	req.Host = target.Host
}

func (lb *LoadBalancer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	proxy := &httputil.ReverseProxy{Director: lb.Director}
	proxy.ServeHTTP(w, r)
}

// 初始化
func newLB() {
	addrs := []string{
		"http://app1:3000",
		"http://app2:3000",
		"http://app3:3000",
	}
	var backends []*url.URL
	for _, addr := range addrs {
		u, _ := url.Parse(addr)
		backends = append(backends, u)
	}
	lb := &LoadBalancer{backends: backends}
	http.ListenAndServe(":8080", lb)
}
```

### 8.6.4 WebSocket 代理

`ReverseProxy` 原生支持 WebSocket 升级：

```go
func wsProxy() {
	target, _ := url.Parse("http://backend:3000")
	proxy := httputil.NewSingleHostReverseProxy(target)
	// 确保 Upgrade 和 Connection 头透传
	proxy.Director = func(req *http.Request) {
		req.URL.Scheme = target.Scheme
		req.URL.Host = target.Host
		req.Host = target.Host
	}
	// WebSocket 的 Upgrade/Connection 是 hop-by-hop 头，
	// ReverseProxy 默认会移除它们，需通过 ModifyResponse 保留
	// 或使用 Transport 自定义处理
	http.ListenAndServe(":8080", proxy)
}
```

### 8.6.5 请求/响应修改

```go
func modifyResponseProxy() *httputil.ReverseProxy {
	return &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = "http"
			req.URL.Host = "backend:3000"
			// 注入认证 token
			req.Header.Set("Authorization", "Bearer "+os.Getenv("TOKEN"))
		},
		ModifyResponse: func(resp *http.Response) error {
			// 修改响应头
			resp.Header.Set("X-Cache", "HIT")
			// 修改响应体（需谨慎）
			if resp.Header.Get("Content-Type") == "text/html" {
				body, _ := io.ReadAll(resp.Body)
				resp.Body.Close()
				modified := strings.ReplaceAll(string(body), "http://", "https://")
				resp.Body = io.NopCloser(bytes.NewBufferString(modified))
				resp.ContentLength = int64(len(modified))
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("代理错误: %v", err)
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(map[string]string{"error": "bad gateway"})
		},
	}
}
```

---

## 小结

| 主题 | 关键点 |
|------|--------|
| TCP | 流协议无边界，用长度前缀解决粘包；SetDeadline 控制超时 |
| UDP | 快但不保序，服务发现/CDN 场景使用；应用层实现可靠传输成本高 |
| HTTP Client | Transport 连接池、超时、重试是性能基础 |
| WebSocket | gorilla/websocket 为主流；Ping/Pong 保活；并发写需加锁 |
| TLS | mTLS 实现双向认证；自签名证书适合开发环境 |
| 反向代理 | httputil.ReverseProxy 轻量强大；ModifyResponse 可修改响应体 |
