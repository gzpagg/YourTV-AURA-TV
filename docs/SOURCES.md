# 公开来源记录

调研日期：2026-10-06（UTC）。目录不包含抓取的临时令牌、非公开接口或绕过登录的播放方案。

## 官方观看页面

- CCTV-1：<https://tv.cctv.com/live/cctv1/>
- CCTV-9：<https://tv.cctv.com/live/cctv9/>
- CCTV-13：<https://tv.cctv.com/live/cctv13/>
- CNN：<https://www.cnn.com/live-tv>
- France 24 English：<https://www.france24.com/en/live>
- CGTN：<https://www.cgtn.com/tv>
- DW English：<https://www.dw.com/en/live-tv/s-100825>
- NASA+：<https://plus.nasa.gov/>

以上页面地址不意味着所有地区都能免费观看。CNN 完整直播可能需要订阅、电视服务商登录或指定地区，目录保留官方入口。

## HLS 候选与出处

| 频道 | 公开地址 | GitHub 来源 |
| --- | --- | --- |
| France 24 English | `https://live.france24.com/hls/live/2037218/F24_EN_HI_HLS/master_5000.m3u8` | [iptv-org / streams/fr.m3u](https://github.com/iptv-org/iptv/blob/master/streams/fr.m3u) |
| CGTN | `https://english-livebkali.cgtn.com/live/encgtn.m3u8` | [iptv-org / streams/cn.m3u](https://github.com/iptv-org/iptv/blob/master/streams/cn.m3u) |
| DW English | `https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/master.m3u8` | [iptv-org / streams/de.m3u](https://github.com/iptv-org/iptv/blob/master/streams/de.m3u) |

上述 GitHub 文件在本次调研返回 HTTP 200。France 24 与 CGTN 的地址使用广播机构域名；DW 使用公开目录列出的 CDN。社区收录不等于机构官方授权；地址可能变更。

补充依据：[Streamlink DW 插件](https://github.com/streamlink/streamlink/blob/master/src/streamlink/plugins/deutschewelle.py)从官方页面读取公开 `<video><source>` HLS；[NASA+ 插件](https://github.com/streamlink/streamlink/blob/master/src/streamlink/plugins/nasaplus.py)从 `#main-video` 读取公开播放源。本应用没有打包这些插件，也没有猜测 NASA 的动态流地址。

## 实际验证与限制

调研时对官方页面及三个精确 HLS 地址的请求，均在云环境代理 CONNECT 阶段返回 403，未到达源站。因此源站状态、清单正文、跨域响应、媒体分片和分辨率均**未完成验证**。不把代理拦截解释为频道下线，也不把公开目录中的 1080p 标签当成实测值。

播放器只显示实际解析到的清晰度，失败时展示重试和官网入口。本地浏览器测试使用 ffmpeg 合成的 HLS 音视频样本；它验证应用的解码和交互，不验证公网电视信号。

云端继续核验所需最小媒体域名：

```text
live.france24.com
english-livebkali.cgtn.com
dwamdstream102.akamaized.net
```

官方页面核验域名：`tv.cctv.com`、`www.cnn.com`、`www.france24.com`、`www.cgtn.com`、`www.dw.com`、`plus.nasa.gov`。播放清单如果引用其他分片域名，需要在成功读取清单后精确追加，而不是预先开放整个 CDN。

这些是云环境网络设置；不会改变最终用户所在网络、浏览器跨域策略、订阅权益或地区限制。
