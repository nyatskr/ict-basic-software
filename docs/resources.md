# 讲解资料台账

> 由 `tools/build-docs.py` 从 `content/catalog.json` 生成，不要手改。

## 验收规则

1. **只有 `verified` 的资料才能当主资料用。** `candidate` 表示链接与时长已核对、内容还没人工看完；`dead` 表示链接失效或内容已被版本淘汰。
2. 每条资料必须记录**适用版本**与**覆盖/缺口**。技术事实以厂商官方文档为最终依据，视频只作讲解。
3. 抖音、小红书只存链接与摘要，不下载、不转载。
4. 每个小节至少准备一条**备用资料**，主资料失效时能立刻替换。
5. 改完内容后重新跑 `python tools/build-data.py`（持有源 Markdown 时传路径刷新基础题）、`python tools/check-content.py` 与 `python tools/build-docs.py`。

## 统计

- 资料总数 **43** 条：视频 35 · 图文 8
- 已人工验收 **3** 条 · 待验收 **40** 条 · 已失效 **0** 条

## 按域查看

### openEuler（oe）

| ID | 平台 | 标题 | 链接 | 类型 | 角色 | 状态 | 覆盖 | 缺口 | 版本口径 | 检查日期 | 用于小节 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `v-perm-who` | B 站 | [5 分钟学 linux] 10-详解文件的所有者、所属组、其他人 | [打开](https://www.bilibili.com/video/BV1FY4y1B7DR/) | 视频 | 主资料 | 待验收 | 三类主体、所有者/属组/其他人 | 未涉及 ACL 与特殊位 | 概念讲解，不绑定发行版 | 2026-10-26 | oe-02-01 |
| `v-perm-str` | B 站 | Linux 文件权限与 chmod：754 到底是什么意思？ | [打开](https://www.bilibili.com/video/BV1pbHA6iEY1/) | 视频 | 补充 | 待验收 | 权限串读法、数字权限换算 | 只讲文件，未讲目录 r/w/x 差异 | 通用 | 2026-10-26 | oe-02-01 |
| `v-perm-chown` | B 站 | 每天一个 Linux 命令 - chown | [打开](https://www.bilibili.com/video/BV19j411i7AM/) | 视频 | 主资料 | 待验收 | chown 用户、chown 用户:组、-R | 未讲 chgrp 与硬链接联动 | 通用 | 2026-10-26 | oe-02-03 |
| `v-perm-ten` | B 站 | Linux 权限，十位 -rwx 详解 | [打开](https://www.bilibili.com/video/BV1MV4y1T771/) | 视频 | 主资料 | 待验收 | 十位权限串、特殊位标记位 | 17:00 偏长，只看前 10 分钟即可覆盖权限串读法 | 通用 | 2026-10-26 | oe-02-01 |
| `a-perm-dir` | 阿里云开发者社区 | 一章让你明白什么是权限（文件与目录的 rwx 差异） | [打开](https://developer.aliyun.com/article/1267820) | 图文 | 主资料 | 待验收 | 目录 r/w/x 语义、删除看父目录、umask 与特殊位简表 | 无视频演示 | 通用 | 2026-10-26 | oe-02-01、oe-02-04 |
| `v-perm-umask` | B 站 | Linux 中的默认权限 - umask | [打开](https://www.bilibili.com/video/BV18Q4y197WP/) | 视频 | 主资料 | 待验收 | 666/777 基准、umask 计算、临时与永久设置 | 未讲目录 setgid 对新建文件的组继承 | 通用 | 2026-10-26 | oe-02-02 |
| `v-perm-umask2` | B 站 | Linux 系统管理：umask 权限掩码 | [打开](https://www.bilibili.com/video/BV1D4421D7Zx/) | 视频 | 补充 | 待验收 | umask 位运算 | 未讲 /etc/profile 与 login.defs | 通用 | 2026-10-26 | oe-02-02 |
| `v-perm-acl` | B 站 | 9 Linux 权限管理之普通文件 ACL 权限设置 | [打开](https://www.bilibili.com/video/BV13i421f7GV/) | 视频 | 主资料 | 待验收 | getfacl、setfacl -m、-x、-b、mask | 默认 ACL 继承只带过 | 通用（需文件系统挂载 acl 选项） | 2026-10-26 | oe-02-05 |
| `a-perm-default-acl` | php.cn | 怎么通过 setfacl -d 设置目录的默认 ACL 继承模板 | [打开](https://www.php.cn/faq/3240339.html) | 图文 | 主资料 | 待验收 | 默认 ACL -d、目录继承规则 | 无视频 | 通用 | 2026-10-26 | oe-02-05 |
| `a-perm-setfacl` | 网页 | setfacl 命令详解（-m / -x / -b / -k / -d / -R） | [打开](https://sukbeta.github.io/setfacl-command/) | 图文 | 补充 | 待验收 | -b 与 -k 的区别、mask 重算 | 站点为个人博客，长期可用性需复查 | 通用 | 2026-10-26 | oe-02-05 |
| `v-perm-sgid` | B 站 | 特殊文件权限之 SGID | [打开](https://www.bilibili.com/video/BV1aZ421u7XN/) | 视频 | 主资料 | 待验收 | 目录 SGID 继承属组 | 未演示协作目录完整配置 | 通用 | 2026-10-26 | oe-02-04 |
| `v-perm-sticky` | B 站 | Linux：演示 SUID SGID SBIT 用法和效果 | [打开](https://www.bilibili.com/video/BV1xk4y1p7LK/) | 视频 | 补充 | 待验收 | sticky bit 防删他人文件 | 演示为主，原理讲得少 | 通用 | 2026-10-26 | oe-02-04 |
| `v-user-groups` | B 站 | 3-3 Linux 用户及用户组创建和管理 | [打开](https://www.bilibili.com/video/BV1tZ4y1e7qa/) | 视频 | 主资料 | 待验收 | useradd/groupadd、主组与附加组 | 未强调 -G 是覆盖、-aG 才是追加 | 通用 | 2026-10-26 | oe-02-03 |
| `v-user-usermod` | B 站 | 每天一个 Linux 命令 - usermod | [打开](https://www.bilibili.com/video/BV1o94y1B75P/) | 视频 | 补充 | 待验收 | -G 与 -aG、-d -s -L | 未讲 /etc/group 与 id 输出对照 | 通用 | 2026-10-26 | oe-02-03 |
| `v-pkg-dnf` | B 站 | linux 懒人运维：rocky linux8.9 介绍-yum 与 dnf 命令 | [打开](https://www.bilibili.com/video/BV1Kw41177e5/) | 视频 | 主资料 | 待验收 | dnf 常用子命令、仓库列表 | 以 Rocky 演示，openEuler 的仓库文件名略有差异 | dnf（RHEL 8/9 通用） | 2026-10-26 | oe-03-01 |
| `v-svc-systemctl` | B 站 | Linux 学习之路 23_服务管理_systemctl 命令 | [打开](https://www.bilibili.com/video/BV1Aa411B7AZ/) | 视频 | 主资料 | 待验收 | start/stop/restart、enable/disable、status | 未讲 enable --now 与 daemon-reload 的时机 | systemd 239+ | 2026-10-26 | oe-03-02 |
| `v-svc-journal` | B 站 | Linux 学习之路 42_Linux 系统日志_journalctl 命令 | [打开](https://www.bilibili.com/video/BV12P4y1u76e/) | 视频 | 主资料 | 待验收 | -u 按单元、-b 按启动、-f 跟随 | 未讲持久化 Storage 配置 | systemd-journald | 2026-10-26 | oe-03-02 |
| `v-proc-state` | B 站 | 136-linux 进程创建-状态查询-僵尸-孤儿-D 状态进程详解 | [打开](https://www.bilibili.com/video/BV1GPn6zvE5z/) | 视频 | 主资料 | 待验收 | R/S/D/T/Z、僵尸与孤儿 | 偏长，Z 与 D 的判读在前半段 | 通用内核行为 | 2026-10-26 | oe-04-01 |
| `v-proc-kill` | B 站 | 89-Linux 进程管理-kill、pkill、killall 杀死进程 | [打开](https://www.bilibili.com/video/BV1bpYp6aETv/) | 视频 | 主资料 | 待验收 | 信号编号、TERM 与 KILL 差别 | 未讲 SIGHUP 与重载配置 | 通用 | 2026-10-26 | oe-04-01 |
| `v-sto-part` | B 站 | Linux 硬盘分区／格式化／挂载，保姆级教程！ | [打开](https://www.bilibili.com/video/BV1pD4y1u7Kf/) | 视频 | 主资料 | 待验收 | fdisk 分区、mkfs、mount | 未讲 GPT 与 parted 的大盘场景 | 通用 | 2026-10-26 | oe-05-01 |
| `v-sto-fstab` | B 站 | 87-linux 存储-fstab 挂载持久化及 UUID 挂载 | [打开](https://www.bilibili.com/video/BV1UFp2zEEHK/) | 视频 | 主资料 | 待验收 | fstab 六字段、UUID 写法、mount -a | 未讲 systemd 生成挂载单元的时机 | 通用 | 2026-10-26 | oe-05-02 |
| `v-sto-lvm` | B 站 | Linux 磁盘管理之 PV,VG,LV 的区别，动手练起来 | [打开](https://www.bilibili.com/video/BV1dY4y1z74o/) | 视频 | 主资料 | 待验收 | 三层关系、pvcreate/vgcreate/lvcreate | 未讲扩容与 -r 连带扩文件系统 | lvm2（通用） | 2026-10-26 | oe-05-02 |
| `v-net-nmcli` | B 站 | 使用 nmcli 命令配置 Linux 网络参数 | [打开](https://www.bilibili.com/video/BV1rmZ3YXETr/) | 视频 | 主资料 | 待验收 | nmcli connection、nmcli device、静态地址 | 16:49 偏长 | NetworkManager / nmcli | 2026-10-26 | oe-06-01 |
| `v-net-ss` | B 站 | Linux 命令之 netstat、ss | [打开](https://www.bilibili.com/video/BV1ZroEBxEBv/) | 视频 | 主资料 | 待验收 | -lntp 各开关含义、ss 与 netstat 对照 | 未讲 ss 的过滤表达式 | iproute2 ss | 2026-10-26 | oe-06-01 |
| `a-fw-firewalld` | 阿里云开发者社区 | Linux firewalld 防火墙使用详解 | [打开](https://developer.aliyun.com/article/1707560) | 图文 | 主资料 | 已验收 | runtime 与 permanent 两套配置及 reload 后的覆盖关系、--runtime-to-permanent、zone 概念、默认区域与接口/源地址绑定、--query-port / --query-service / --list-all-zones、富规则 rich rule、端口转发、ipset、lockdown、panic | 不讲 SELinux 与防火墙是两层控制（本站补充里补了）；示例里 echo "net.ipv4.ip_forward=1" >> /proc/sys/net/ipv4/ip_forward 是错的，该用 sysctl -w；只提 CentOS/RHEL/Fedora，没说 openEuler；无视频演示 | firewalld / firewall-cmd | 2026-10-27 | oe-06-02 |
| `a-fw-tc` | tencent | CentOS 7 上的 FirewallD 简明指南（腾讯云开发者社区） | [打开](https://cloud.tencent.com/developer/article/2273936) | 图文 | 备用 | 待验收 | 九个预定义 zone 的含义、--get-default-zone / --set-default-zone、--permanent 加规则再 --reload 生效、--add-service 与 --add-port 的区别 | 只演示用法，没把 runtime 与 permanent 讲成两套独立视图；文末 --list-all 与查询命令被截断；面向 CentOS 7 | firewalld / zone | 2026-10-27 | oe-06-02 |
| `v-fw-port` | B 站 | Linux 中如何开放防火墙端口？ | [打开](https://www.bilibili.com/video/BV1JF411E7H8/) | 视频 | 补充 | 待验收 | --add-port 实操 | 是否演示 --permanent + --reload 需人工确认 | firewalld --add-port | 2026-10-26 | oe-06-02 |
| `v-file-hardlink` | B 站 | linux 中的硬链接和软连接 | [打开](https://www.bilibili.com/video/BV1zK4y1R7jr/) | 视频 | 主资料 | 已验收 | inode 与目录项、硬链接限制、软链接相对路径 | 讲了 ls -l 第二列硬链接数（原缺口注过时）；软链接相对路径只演示失败并建议写绝对路径，未讲按链接所在目录解析的规则；目录硬链接数语义未展开；含 rm -rf 删目录软链接误删源目录的实例 | 通用 | 2026-10-26 | oe-01-01 |
| `v-file-tar` | B 站 | 10 分钟学会 gzip 和 tar 命令 | [打开](https://www.bilibili.com/video/BV1dQ4y1R7Lg/) | 视频 | 主资料 | 待验收 | tar -czf/-xzf 归档压缩与解压、gzip 单文件压缩/-d/-l/-r | -C 指定目录、-t 只列不解未讲（原 covers 注与实际不符）；未讲 -p 保留权限 | 通用 | 2026-10-26 | oe-01-02 |
| `v-file-find` | B 站 | 每天一个 Linux 命令 - find | [打开](https://www.bilibili.com/video/BV1nh4y1r7Zq/) | 视频 | 主资料 | 待验收 | -name 通配符与 -iname、-type f/d/l 组合 | 未讲 -name 模式的引号问题（原 covers 注与实际不符）；未讲 -size；-mmin/-mtime 只演示 +/- 基本用法，取整规则未细讲 | 通用 | 2026-10-26 | oe-01-01 |
| `a-file-find` | 网页 | Linux find 命令（-mtime 与 -size 用法） | [打开](https://www.runoob.com/linux/linux-comm-find.html) | 图文 | 补充 | 待验收 | -size 单位与正负号、-mtime 取整规则 | 中文示例较少 | 通用 | 2026-10-26 | oe-01-01 |
| `a-file-link-tc` | tencent | 【Linux】软硬连接（腾讯云开发者社区） | [打开](https://cloud.tencent.com/developer/article/2431109) | 图文 | 备用 | 待验收 | 硬链接不分配新 inode、删源文件后硬链接仍可读、引用计数减 1、软链接保存路径，目标删掉就失效 | 不讲 find；「三.软链接」开头一句把软链接写成「通过硬链接」，读到这里别被带偏；没有 ls -l 第二列链接数的读法 | 通用 | 2026-10-26 | oe-01-01 |
| `v-file-redirect` | B 站 | Shell 其实很简单（11）深入理解 Shell 中的重定向 | [打开](https://www.bilibili.com/video/BV1Hm411m7kP/) | 视频 | 主资料 | 已验收 | > 与 >>、2>、文件描述符 | 2>&1 只讲合并用法与「>&1 和 2> 之间不能有空格」，未讲 cmd 2>&1 > out 这类书写顺序陷阱 | 通用 | 2026-10-26 | oe-01-02 |
| `v-file-2to1` | B 站 | Linux nohup 命令及标准错误重定向语法 2>&1 详解 | [打开](https://www.bilibili.com/video/BV1hC32zfEDG/) | 视频 | 补充 | 待验收 | 2>&1 的指向语义、与 &> 的区别 | 以 nohup 场景切入 | 通用 | 2026-10-26 | oe-01-02 |
| `a-redirect-aliyun` | 阿里云开发者社区 | 详解 Linux 重定向 2>&1 与 &> 的含义和正确顺序 | [打开](https://developer.aliyun.com/article/977075) | 图文 | 备用 | 待验收 | 0/1/2 文件描述符、2>&1 为什么必须写在 >log 之后、2>1 会写成名为 1 的文件、&> 与 >log 2>&1 等价 | 只讲输出重定向，不讲输入重定向与管道；示例是 Java 程序，命令本身与发行版无关 | 通用 | 2026-10-26 | oe-01-02 |
| `v-shell-quote` | B 站 | [5 分钟学 linux] 38-自定义变量的 3 种赋值方法及单引号、双引号、无引号的区别 | [打开](https://www.bilibili.com/video/BV1Ru411C7UN/) | 视频 | 主资料 | 待验收 | 单引号不展开、双引号展开、无引号的分词 | 偏长 | 通用 | 2026-10-26 | oe-07-01 |
| `v-shell-exit` | B 站 | Shell 其实很简单（15）命令的退出状态码 | [打开](https://www.bilibili.com/video/BV15Z421e79c/) | 视频 | 主资料 | 待验收 | $? 语义、0 与非 0 | 未讲 set -e 与管道退出码 | 通用 | 2026-10-26 | oe-07-01 |
| `v-cron` | B 站 | Linux 定时任务 crontab 详解 | [打开](https://www.bilibili.com/video/BV1Tv411G7dn/) | 视频 | 主资料 | 待验收 | 五字段、crontab -e、系统级任务多一个 user 字段 | 偏长；cron 扫描周期未讲 | 通用 | 2026-10-26 | oe-03-03 |
| `v-cron-5min` | B 站 | 5 分钟的 Linux-crontab 定时任务 | [打开](https://www.bilibili.com/video/BV1BLzrYHE6C/) | 视频 | 补充 | 待验收 | 快速写一条定时任务、PATH 问题 | 字段边界值未覆盖 | 通用 | 2026-10-26 | oe-03-03 |
| `v-ctr-podman` | B 站 | 八分钟入门 docker 的继承者 podman | [打开](https://www.bilibili.com/video/BV1s54y1E7YE/) | 视频 | 主资料 | 待验收 | 镜像与容器基本操作 | 讲的是 Podman，iSula 的选项差异需自行核对 isula --help；作者已注销，链接失效需替换 | Podman 入门（iSula 命令高度相似） | 2026-10-26 | oe-08-01 |

### openGauss（og）

_暂无收录资料。_

### 鲲鹏应用开发（kp）

_暂无收录资料。_

## 未被任何小节引用

`v-perm-chmod`、`v-perm-octal`、`v-perm-suid`

