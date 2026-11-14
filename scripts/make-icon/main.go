// make-icon 把方形满幅的图标素材做成应用图标。在仓库任意位置运行：
//
//	go run -C scripts/make-icon . [素材路径，相对仓库根目录，默认 docs/images/icon-source.png]
//
// 输出（路径相对仓库根目录）：
//   - resources/icon.png：1024×1024 RGBA，按 macOS 图标网格把素材缩进 824×824、
//     圆角半径 185.4 的圆角方形（四周 100px 透明边距），带一层柔和投影。
//     mygo build 用它生成 .icns、Windows 图标资源和 Linux 桌面图标。
//   - resources/icon-dev.png：同上，右下角加橙色「Dev」徽章，mygo dev 构建的开发版用它，
//     不随正式版发布。徽章完全落在圆角方形内部，透明通道、外轮廓和投影与正式版一致，
//     避免 macOS 把轮廓不规则的图标识别成异形图标、额外套一层底板。
//   - frontend/public/icon.png：正式版图标缩到 256×256，供启动页和关于页显示。
//
// 素材要求：正方形、满幅（不要自带圆角或透明边），最好 1024×1024。
// 这个脚本是独立的 Go 模块，渲染文字用的 golang.org/x/image 不进入 App 的依赖。
package main

import (
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"

	"golang.org/x/image/font"
	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/opentype"
	"golang.org/x/image/math/fixed"
)

const (
	canvas  = 1024
	body    = 824   // 圆角方形边长
	inset   = 100   // (canvas-body)/2
	radius  = 185.4 // 圆角半径
	shadowY = 10    // 投影向下偏移
	shadowR = 14    // 投影模糊半径（三次盒式模糊）
	shadowA = 0.30  // 投影不透明度
	webSize = 256

	// Dev 徽章：胶囊形，右下角，距圆角方形右边和下边各 badgeM。
	// 胶囊半径 badgeH/2=100 时，badgeM ≥ 25 才能完全落在 185.4 的圆角内。
	badgeText    = "Dev"
	badgeH       = 200
	badgeM       = 44
	badgePad     = 78  // 文字左右留白
	badgeFont    = 132 // 字号（px）
	badgeShadowY = 6   // 徽章投影
	badgeShadowR = 8
	badgeShadowA = 0.28
)

var (
	badgeTop    = color.NRGBA{0xFF, 0xB0, 0x20, 0xFF} // 徽章渐变：上
	badgeBottom = color.NRGBA{0xF5, 0x7C, 0x00, 0xFF} // 徽章渐变：下
)

func main() {
	root, err := repoRoot()
	check(err)
	srcPath := "docs/images/icon-source.png"
	if len(os.Args) > 2 {
		check(errors.New("usage: go run -C scripts/make-icon . [source.png]"))
	}
	if len(os.Args) == 2 {
		srcPath = os.Args[1]
	}
	src, err := load(filepath.Join(root, srcPath))
	check(err)
	if b := src.Bounds(); b.Dx() != b.Dy() {
		check(fmt.Errorf("素材必须是正方形，实际 %dx%d", b.Dx(), b.Dy()))
	}

	mask := roundedMask(inset, inset, inset+body, inset+body, radius)
	art := resample(src, body)

	icon := compose(mask, func(x, y int) [4]float64 {
		return unpremul(art.NRGBAAt(x-inset, y-inset))
	})
	badge := badgeLayer()
	dev := compose(mask, func(x, y int) [4]float64 {
		return over(badge[y*canvas+x], unpremul(art.NRGBAAt(x-inset, y-inset)))
	})

	check(save(filepath.Join(root, "resources/icon.png"), icon))
	check(save(filepath.Join(root, "resources/icon-dev.png"), dev))
	check(save(filepath.Join(root, "frontend/public/icon.png"), resample(icon, webSize)))
	fmt.Println("wrote resources/icon.png, resources/icon-dev.png, frontend/public/icon.png")
}

// compose 用圆角方形裁出图标本体（颜色由 pixel 给出，预乘），再叠到投影上。
func compose(mask []float64, pixel func(x, y int) [4]float64) *image.NRGBA {
	shadow := blur(mask, shadowR)
	out := image.NewNRGBA(image.Rect(0, 0, canvas, canvas))
	for y := 0; y < canvas; y++ {
		for x := 0; x < canvas; x++ {
			var c [4]float64
			if m := mask[y*canvas+x]; m > 0 {
				p := pixel(x, y)
				c = [4]float64{p[0] * m, p[1] * m, p[2] * m, p[3] * m}
			}
			sa := 0.0
			if sy := y - shadowY; sy >= 0 {
				sa = shadow[sy*canvas+x] * shadowA
			}
			c = over(c, [4]float64{0, 0, 0, sa})
			out.SetNRGBA(x, y, toNRGBA(c))
		}
	}
	return out
}

// badgeLayer 画出 Dev 徽章（含投影），返回每个像素的预乘颜色。
func badgeLayer() [][4]float64 {
	f, err := opentype.Parse(gobold.TTF)
	check(err)
	face, err := opentype.NewFace(f, &opentype.FaceOptions{Size: badgeFont, DPI: 72, Hinting: font.HintingNone})
	check(err)
	defer face.Close()

	ink, _ := font.BoundString(face, badgeText)
	inkW := (ink.Max.X - ink.Min.X).Ceil()
	inkH := (ink.Max.Y - ink.Min.Y).Ceil()

	x1 := float64(inset + body - badgeM)
	y1 := float64(inset + body - badgeM)
	x0 := x1 - float64(inkW+2*badgePad)
	y0 := y1 - badgeH
	pill := roundedMask(x0, y0, x1, y1, badgeH/2)
	pillShadow := blur(pill, badgeShadowR)

	// 文字：墨迹框在胶囊内居中
	text := image.NewAlpha(image.Rect(0, 0, canvas, canvas))
	ox := (x0+x1)/2 - float64(inkW)/2 - fixedF(ink.Min.X)
	oy := (y0+y1)/2 - float64(inkH)/2 - fixedF(ink.Min.Y)
	d := font.Drawer{Dst: text, Src: image.Opaque, Face: face, Dot: fixed.Point26_6{X: toFixed(ox), Y: toFixed(oy)}}
	d.DrawString(badgeText)

	layer := make([][4]float64, canvas*canvas)
	for y := 0; y < canvas; y++ {
		t := math.Min(math.Max((float64(y)-y0)/badgeH, 0), 1)
		bg := lerp(badgeTop, badgeBottom, t)
		for x := 0; x < canvas; x++ {
			i := y*canvas + x
			var c [4]float64
			if sy := y - badgeShadowY; sy >= 0 {
				c = [4]float64{0, 0, 0, pillShadow[sy*canvas+x] * badgeShadowA}
			}
			if p := pill[i]; p > 0 {
				c = over([4]float64{bg[0] * p, bg[1] * p, bg[2] * p, p}, c)
				if a := float64(text.AlphaAt(x, y).A) / 255 * p; a > 0 {
					c = over([4]float64{a, a, a, a}, c)
				}
			}
			layer[i] = c
		}
	}
	return layer
}

// roundedMask 返回圆角矩形的覆盖率（4×4 超采样抗锯齿）。
func roundedMask(x0, y0, x1, y1, r float64) []float64 {
	const ss = 4
	m := make([]float64, canvas*canvas)
	for y := int(y0); y < int(math.Ceil(y1)) && y < canvas; y++ {
		for x := int(x0); x < int(math.Ceil(x1)) && x < canvas; x++ {
			n := 0
			for j := 0; j < ss; j++ {
				for i := 0; i < ss; i++ {
					px := float64(x) + (float64(i)+0.5)/ss
					py := float64(y) + (float64(j)+0.5)/ss
					if insideRounded(px, py, x0, y0, x1, y1, r) {
						n++
					}
				}
			}
			m[y*canvas+x] = float64(n) / (ss * ss)
		}
	}
	return m
}

func insideRounded(x, y, x0, y0, x1, y1, r float64) bool {
	if x < x0 || x > x1 || y < y0 || y > y1 {
		return false
	}
	cx := math.Min(math.Max(x, x0+r), x1-r)
	cy := math.Min(math.Max(y, y0+r), y1-r)
	dx, dy := x-cx, y-cy
	return dx*dx+dy*dy <= r*r
}

// blur 对覆盖率做三次盒式模糊，近似高斯。
func blur(src []float64, r int) []float64 {
	a := append([]float64(nil), src...)
	b := make([]float64, len(a))
	for pass := 0; pass < 3; pass++ {
		boxH(a, b, r)
		boxV(b, a, r)
	}
	return a
}

func boxH(src, dst []float64, r int) {
	w := float64(2*r + 1)
	for y := 0; y < canvas; y++ {
		row := src[y*canvas : (y+1)*canvas]
		sum := 0.0
		for x := -r; x <= r; x++ {
			sum += at(row, x)
		}
		for x := 0; x < canvas; x++ {
			dst[y*canvas+x] = sum / w
			sum += at(row, x+r+1) - at(row, x-r)
		}
	}
}

func boxV(src, dst []float64, r int) {
	w := float64(2*r + 1)
	col := make([]float64, canvas)
	for x := 0; x < canvas; x++ {
		for y := 0; y < canvas; y++ {
			col[y] = src[y*canvas+x]
		}
		sum := 0.0
		for y := -r; y <= r; y++ {
			sum += at(col, y)
		}
		for y := 0; y < canvas; y++ {
			dst[y*canvas+x] = sum / w
			sum += at(col, y+r+1) - at(col, y-r)
		}
	}
}

func at(s []float64, i int) float64 {
	if i < 0 || i >= len(s) {
		return 0
	}
	return s[i]
}

// resample 用面积加权平均把图缩放到 size×size（预乘透明度，避免边缘发黑）。
func resample(src image.Image, size int) *image.NRGBA {
	b := src.Bounds()
	sw, sh := b.Dx(), b.Dy()
	px := make([][4]float64, sw*sh)
	for y := 0; y < sh; y++ {
		for x := 0; x < sw; x++ {
			c := color.NRGBAModel.Convert(src.At(b.Min.X+x, b.Min.Y+y)).(color.NRGBA)
			px[y*sw+x] = unpremul(c)
		}
	}
	fx, fy := float64(sw)/float64(size), float64(sh)/float64(size)
	out := image.NewNRGBA(image.Rect(0, 0, size, size))
	for oy := 0; oy < size; oy++ {
		y0, y1 := float64(oy)*fy, float64(oy+1)*fy
		for ox := 0; ox < size; ox++ {
			x0, x1 := float64(ox)*fx, float64(ox+1)*fx
			var acc [4]float64
			wsum := 0.0
			for sy := int(y0); sy < int(math.Ceil(y1)) && sy < sh; sy++ {
				wy := math.Min(y1, float64(sy+1)) - math.Max(y0, float64(sy))
				for sx := int(x0); sx < int(math.Ceil(x1)) && sx < sw; sx++ {
					wx := math.Min(x1, float64(sx+1)) - math.Max(x0, float64(sx))
					w := wx * wy
					p := px[sy*sw+sx]
					for k := range acc {
						acc[k] += p[k] * w
					}
					wsum += w
				}
			}
			for k := range acc {
				acc[k] /= wsum
			}
			out.SetNRGBA(ox, oy, toNRGBA(acc))
		}
	}
	return out
}

// unpremul 把 NRGBA 转成预乘的 [r g b a]（0–1）。名字取「从非预乘转来」之意。
func unpremul(c color.NRGBA) [4]float64 {
	a := float64(c.A) / 255
	return [4]float64{float64(c.R) / 255 * a, float64(c.G) / 255 * a, float64(c.B) / 255 * a, a}
}

// over 把预乘颜色 top 叠在 bottom 上。
func over(top, bottom [4]float64) [4]float64 {
	k := 1 - top[3]
	return [4]float64{top[0] + bottom[0]*k, top[1] + bottom[1]*k, top[2] + bottom[2]*k, top[3] + bottom[3]*k}
}

func toNRGBA(c [4]float64) color.NRGBA {
	if c[3] <= 0 {
		return color.NRGBA{}
	}
	return color.NRGBA{R: u8(c[0] / c[3]), G: u8(c[1] / c[3]), B: u8(c[2] / c[3]), A: u8(c[3])}
}

func lerp(a, b color.NRGBA, t float64) [3]float64 {
	f := func(x, y uint8) float64 { return (float64(x)*(1-t) + float64(y)*t) / 255 }
	return [3]float64{f(a.R, b.R), f(a.G, b.G), f(a.B, b.B)}
}

func u8(v float64) uint8 {
	return uint8(math.Round(math.Min(math.Max(v, 0), 1) * 255))
}

func fixedF(v fixed.Int26_6) float64  { return float64(v) / 64 }
func toFixed(v float64) fixed.Int26_6 { return fixed.Int26_6(math.Round(v * 64)) }

// repoRoot 从当前目录向上找到含 mygo.config.ts 的仓库根目录。
func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "mygo.config.ts")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", errors.New("找不到仓库根目录（mygo.config.ts）")
		}
		dir = parent
	}
}

func load(path string) (image.Image, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return png.Decode(f)
}

func save(path string, img image.Image) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	if err := enc.Encode(f, img); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

func check(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
