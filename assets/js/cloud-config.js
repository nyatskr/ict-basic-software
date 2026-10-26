/* cloud-config.js — Supabase 连接配置
 *
 * 这里只放「可以公开」的信息：Project URL 与 Publishable key。
 * 它们会出现在网页源码里，属于正常现象；数据安全由数据库的 RLS 策略保证。
 *
 * 绝对不要把这个文件改成放 secret / service_role key —— 那等于把数据库密码写进网页。
 *
 * 本项目与 Linux 练习站共用同一个 Supabase 项目（同一个 GitHub OAuth App），
 * 但数据表是分开的：ict_progress_records / ict_lab_results。
 * 填法见 docs/cloud-sync.md，两行都留空时网站按纯本地模式运行。
 */
window.ICT_CLOUD_CONFIG = Object.freeze({
  url: 'https://mvrdlzjnhxzhqxszpcgi.supabase.co',
  publishableKey: 'sb_publishable_qHVLmszRej7auNOStAk1ZQ_GRP6rTDA',
});
