# uu 単語帳

独立的单词卡账号版，支持邮箱验证、登录、按账号同步单词及学习记录，以及浏览器本地照片识别。

网站：https://0uuuuov0.github.io/uu-wordbook/

## 发布

GitHub Pages 从 main 分支根目录发布。网站为静态文件，必须一起上传 account/ 和 ocr/，无需安装或构建。此仓库与原 yoniou 网站分开维护。

## 数据

用户数据保存在 Supabase，account/config.js 只包含公开的项目地址和 Publishable key。account/schema.sql 中的 RLS 和保存函数负责账号隔离和版本冲突保护。不要把数据库密码、SMTP 授权码或 service_role / secret key 提交到仓库。

登录后同步分组、单词和学习记录；本机模式与壁纸保存在浏览器。旧版记录可在账号面板选择导入。正式修改数据结构前应先备份。

## 配置

Supabase Auth 的 Site URL 与 Redirect URLs 需包含正式网站地址。已启用邮箱验证，发件人名称为 uu 単語帳。

## 验证范围

已测试客户端同步与冲突处理、数据库行权限、匿名访问拒绝、本地注册邮箱验证、照片识别，以及桌面和平板/手机尺寸布局。不同真实设备与 Safari、持续大量照片识别仍需要实际使用验证。

OCR 依赖及其许可证随 ocr/ 提供，Supabase 客户端许可证位于 account/supabase-LICENSE.txt。
