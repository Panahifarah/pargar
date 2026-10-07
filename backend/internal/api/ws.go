package api

import (
	"context"
	"encoding/json"
	"log"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
)

const pushChannel = "pargar:push"

// Hub manages per-user websocket connections and fans out messages.
// Messages are published on a shared Redis channel so all instances deliver to their own local clients.
type Hub struct {
	mu    sync.RWMutex
	conns map[int64]map[*Client]struct{}
	rdb   *redis.Client
}

type Client struct {
	hub  *Hub
	conn *websocket.Conn
	user int64
	send chan []byte
	once sync.Once
}

func NewHub(rdb *redis.Client) *Hub {
	h := &Hub{
		conns: map[int64]map[*Client]struct{}{},
		rdb:   rdb,
	}
	go h.subscribe()
	return h
}

func (h *Hub) subscribe() {
	ctx := context.Background()
	sub := h.rdb.Subscribe(ctx, pushChannel)
	defer sub.Close()
	ch := sub.Channel()
	for msg := range ch {
		var p struct {
			User int64           `json:"user"`
			Data json.RawMessage `json:"data"`
		}
		if err := json.Unmarshal([]byte(msg.Payload), &p); err != nil {
			continue
		}
		h.deliver(p.User, p.Data)
	}
}

// Push fans a message out to a user across all instances.
func (h *Hub) Push(userID int64, msg any) {
	b, err := json.Marshal(msg)
	if err != nil {
		return
	}
	payload, _ := json.Marshal(map[string]any{"user": userID, "data": json.RawMessage(b)})
	h.rdb.Publish(context.Background(), pushChannel, payload)
}

func (h *Hub) deliver(userID int64, data []byte) {
	h.mu.RLock()
	clients := h.conns[userID]
	for c := range clients {
		select {
		case c.send <- data:
		default:
		}
	}
	h.mu.RUnlock()
}

// Online reports whether a user currently has at least one live connection.
func (h *Hub) Online(userID int64) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.conns[userID]) > 0
}

// Register adds a new client connection for a user.
func (h *Hub) Register(userID int64, conn *websocket.Conn) *Client {
	c := &Client{hub: h, conn: conn, user: userID, send: make(chan []byte, 16)}
	h.mu.Lock()
	if h.conns[userID] == nil {
		h.conns[userID] = map[*Client]struct{}{}
	}
	h.conns[userID][c] = struct{}{}
	h.mu.Unlock()
	go c.writePump()
	go c.readPump()
	return c
}

func (h *Hub) Unregister(c *Client) {
	h.mu.Lock()
	if set, ok := h.conns[c.user]; ok {
		if _, ok := set[c]; ok {
			delete(set, c)
			if len(set) == 0 {
				delete(h.conns, c.user)
			}
		}
	}
	h.mu.Unlock()
	close(c.send)
}

// close unregisters the client and closes its connection exactly once,
// even though both readPump and writePump may return independently.
func (c *Client) close() {
	c.once.Do(func() {
		c.hub.Unregister(c)
		c.conn.Close()
	})
}

func (c *Client) writePump() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("ws writePump recovered user=%d: %v", c.user, r)
		}
	}()
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		c.close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *Client) readPump() {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("ws readPump recovered user=%d: %v", c.user, r)
		}
	}()
	defer c.close()
	c.conn.SetReadLimit(4096)
	c.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(70 * time.Second))
		return nil
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			// close errors are expected; log genuinely unexpected ones only.
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("ws read err user=%d: %v", c.user, err)
			}
			return
		}
		var incoming struct {
			Type string `json:"type"`
			To   int64  `json:"to"`
		}
		if json.Unmarshal(data, &incoming) == nil && incoming.Type == "typing" && incoming.To > 0 {
			c.hub.Push(incoming.To, map[string]any{"type": "typing", "from": c.user})
		}
	}
}
