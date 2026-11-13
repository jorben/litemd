// LiteMd：一个文件一个窗口的 Markdown 查看与编辑器。
package main

import (
	"log"

	"github.com/egoist/mygo"
)

func main() {
	mygo.App.WhenReady(func() {
		mygo.NewWindow(mygo.WindowOptions{
			Title:           "LiteMd",
			Width:           880,
			Height:          720,
			MinWidth:        420,
			MinHeight:       320,
			BackgroundColor: "light-dark(#ffffff, #1e1e1e)",
			URL:             "/",
		})
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
