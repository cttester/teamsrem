package main

import (
	"fmt"
	"sync"
	"time"
)

func producer(ch chan int, itemCount int) {
	defer close(ch)
	for i := 0; i < itemCount; i++ {
		ch <- i
	}
}

func consumer(ch chan int, wg *sync.WaitGroup, _ string) {
	defer wg.Done()
	for range ch {
		time.Sleep(1 * time.Microsecond)
	}
}

func benchmarkBufferedChannel(bufferSize, itemCount int) time.Duration {
	start := time.Now()
	var wg sync.WaitGroup
	wg.Add(2)
	ch := make(chan int, bufferSize)
	go consumer(ch, &wg, "A")
	go consumer(ch, &wg, "B")
	producer(ch, itemCount)
	wg.Wait()
	return time.Since(start)
}

func main() {
	itemCount := 100_000
	fmt.Println("Buffer Size | Execution Time")
	for bufSize := 1; bufSize < itemCount; bufSize *= 2 {
		duration := benchmarkBufferedChannel(bufSize, itemCount)
		fmt.Printf("%11d | %v\n", bufSize, duration)
	}
}
