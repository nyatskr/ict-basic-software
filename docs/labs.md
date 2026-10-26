# 模拟实操说明

> 由 `tools/build-docs.py` 从 `content/labs.json` 生成，不要手改。

## 设计原则

- **按最终状态评分，不按命令字符串评分。** 校验项读的是状态机里的最终状态（用户属组、文件 mode、服务 active/enabled、防火墙端口、PV/VG/LV/挂载、角色授权），因此 `chmod 3770` 与 `chmod u=rwx,g=rwx,o= && chmod g+s,o+t` 两种写法都算对（单独 `chmod g+s,o+t` 只加特殊位，不构成等价）。
- 分值合计固定 100，**≥80 分算通过**。未通过时逐项列出没打勾的校验项。
- 每个实验都能**一键重置**，回到 `initial_state` 重来，不计惩罚。
- 实验分三层：L1 只读证据做判断；L2 可操作的状态机模拟；L3 真实沙箱（尚未接入）。

## 实验清单

| ID | 名称 | 域 | 类型 | 层级 | 分值项 | 通过线 |
| --- | --- | --- | --- | --- | --- | --- |
| `oe-lab-perm-01` | 协作目录：用户、组与权限 | openEuler | 终端 | L2 状态实验 | 7 | 80 |
| `oe-lab-svc-01` | 服务自启与端口持久放行 | openEuler | 终端 | L2 状态实验 | 4 | 80 |
| `oe-lab-lvm-01` | LVM 建卷、持久挂载与扩容 | openEuler | 终端 | L2 状态实验 | 7 | 80 |
| `og-lab-grant-01` | 最小权限授权 | openGauss | SQL 控制台 | L2 状态实验 | 5 | 80 |
| `kp-lab-scan-01` | 迁移依赖审查：给 6 个组件定处理方式 | 鲲鹏应用开发 | 证据审查 | L1 引导模拟 | 6 | 80 |
| `oe-lab-files-01` | 日志留存：硬链接、软链接与归档 | openEuler | 终端 | L2 状态实验 | 5 | 80 |
| `oe-lab-net-01` | 换静态地址，再确认端口在监听 | openEuler | 终端 | L2 状态实验 | 6 | 80 |

## 协作目录：用户、组与权限（`oe-lab-perm-01`）

- 类型：终端 · 层级：L2 状态实验 · 建议 15 分钟
- 适用版本：openEuler 24.03-LTS-SP2
- 归属：openEuler / oe-02 / oe-02-04 协作目录：setgid 与 sticky bit

**场景**：团队要在 /srv/share 里协作：dev 组成员都能读写，新建的文件自动属于 dev 组，但任何人都不能删除别人建的文件。alice 原本就在 ops 组，不能把她从 ops 里踢出去。

**这一题要练**

- 用 -aG 追加附加组而不是覆盖
- 用 chgrp + chmod 组合出 3770
- 验证 setgid 让新文件继承属组
- 验证 sticky 阻止跨用户删除

**任务**

1. 创建 dev 组，把 alice 追加进去（保留她原有的 ops 组）
2. 把 bob 也加入 dev 组
3. 把 /srv/share 的属组改为 dev
4. 把 /srv/share 设为 3770：属组可写、新文件继承 dev 组、组内不能删别人的文件
5. 以 alice 身份在 /srv/share 下创建 notes.md，并确认它的属组是 dev
6. 验证：root 能删 old.txt，alice 删不掉（用 rm 试一次，看返回什么）

**校验项（合计 100 分）**

| 校验项 | 判据 | 分值 |
| --- | --- | --- |
| dev 组已创建 | `groups.dev` 存在 | 10 |
| alice 已加入 dev | `users.alice.groups` 含 `dev` | 10 |
| alice 仍保留 ops 附加组 | `users.alice.groups` 含 `ops` | 10 |
| /srv/share 属组为 dev | `files./srv/share.group` == `dev` | 15 |
| /srv/share 权限为 3770 | `files./srv/share.mode` == `3770` | 20 |
| alice 已创建 notes.md | `files./srv/share/notes.md` 存在 | 15 |
| notes.md 属组为 dev（setgid 生效） | `files./srv/share/notes.md.group` == `dev` | 20 |

**提示（可在页面逐条展开）**

- `usermod -aG dev alice` 的 `-a` 是追加，漏掉就变成覆盖，ops 会丢。
- setgid 是四位权限的第一位 2，sticky 是 1；两个都要就是 3 开头。
- 切换身份执行命令：`sudo -u alice touch /srv/share/notes.md`。

**参考解法（只是一种写法）**

```bash
groupadd dev
usermod -aG dev alice
usermod -aG dev bob
chgrp dev /srv/share
chmod 3770 /srv/share
sudo -u alice touch /srv/share/notes.md
ls -l /srv/share
```

## 服务自启与端口持久放行（`oe-lab-svc-01`）

- 类型：终端 · 层级：L2 状态实验 · 建议 12 分钟
- 适用版本：openEuler 24.03-LTS-SP2
- 归属：openEuler / oe-03 / oe-03-02 systemd 与 journalctl

**场景**：app 服务装在 /opt/app，监听 8080。要求：现在就要跑起来，重启后也要自动跑；防火墙放行 8080/tcp，而且重启后规则不能丢。

**这一题要练**

- 用 enable --now 一次完成“现在启动 + 开机自启”
- 分清 firewall-cmd 的 runtime 与 permanent 两套配置
- 用 --reload 把持久配置刷进运行时

**任务**

1. 启动 app 服务，并设为开机自启
2. 持久放行 8080/tcp，并让它立即生效
3. 用 ss -lntp 确认 8080 在监听，用 firewall-cmd --list-all 确认端口已放行

**校验项（合计 100 分）**

| 校验项 | 判据 | 分值 |
| --- | --- | --- |
| app.service 正在运行 | `services.app.service.active` == `True` | 25 |
| app.service 已设为开机自启 | `services.app.service.enabled` == `True` | 25 |
| 运行时已放行 8080/tcp | `firewall.runtime.ports` 含 `8080/tcp` | 25 |
| 持久配置已放行 8080/tcp | `firewall.permanent.ports` 含 `8080/tcp` | 25 |

**提示（可在页面逐条展开）**

- `systemctl start` 只改当前状态，`enable` 只改开机策略；两个都要写 `enable --now`。
- `firewall-cmd --add-port=8080/tcp` 只改运行时；加 `--permanent` 改的是持久配置，但不会立刻生效。
- 先 `--permanent --add-port=8080/tcp`，再 `--reload`，两套配置就都对了。

**参考解法（只是一种写法）**

```bash
systemctl enable --now app.service
systemctl status app.service
firewall-cmd --permanent --add-port=8080/tcp
firewall-cmd --reload
firewall-cmd --query-port=8080/tcp
ss -lntp
```

## LVM 建卷、持久挂载与扩容（`oe-lab-lvm-01`）

- 类型：终端 · 层级：L2 状态实验 · 建议 18 分钟
- 适用版本：openEuler 24.03-LTS-SP2
- 归属：openEuler / oe-05 / oe-05-02 LVM 三层与 fstab 持久挂载

**场景**：新加了一块 20G 的空盘 /dev/vdb。要求：用 LVM 划出 5G 给 /data，格式化 XFS，写进 fstab 保证重启后自动挂载；验收后把 /data 扩到 10G。

**这一题要练**

- 按 PV → VG → LV → 文件系统 → 挂载 的顺序操作
- 用 blkid 取 UUID 并写入 fstab
- 用 mount -a 与 findmnt 验证，而不是重启赌
- 用 lvextend -r 连带扩容文件系统

**任务**

1. 把 /dev/vdb 做成 PV
2. 创建卷组 vg_data，并把该 PV 加进去
3. 在 vg_data 上创建 5G 的逻辑卷 lv_app
4. 把逻辑卷格式化为 XFS
5. 挂到 /data，并用 UUID 写进 fstab，然后 mount -a 验证
6. 把 /data 扩到 10G（文件系统一起扩）

**校验项（合计 100 分）**

| 校验项 | 判据 | 分值 |
| --- | --- | --- |
| /dev/vdb 已成为 PV | `pvs./dev/vdb` 存在 | 10 |
| vg_data 已包含该 PV | `vgs.vg_data.pvs` 含 `/dev/vdb` | 10 |
| 逻辑卷 lv_app 已创建 | `lvs.vg_data/lv_app` 存在 | 10 |
| 逻辑卷已格式化为 XFS | `lvs.vg_data/lv_app.fs` == `xfs` | 15 |
| /data 已挂载到该逻辑卷 | `mounts./data.dev` == `/dev/vg_data/lv_app` | 20 |
| fstab 有 /data 的 UUID 条目 | fstab 含 `{'mount': '/data', 'specPrefix': 'UUID='}` | 20 |
| 逻辑卷已扩到 10G | `lvs.vg_data/lv_app.size_mb` ≥ `10240` | 15 |

**提示（可在页面逐条展开）**

- 顺序是 pvcreate → vgcreate → lvcreate → mkfs.xfs → mount → fstab。跳一步后面全错。
- `blkid /dev/vg_data/lv_app` 取 UUID；fstab 首字段写 `UUID=xxx`，第二字段写挂载点。
- 扩容量用 `lvextend -L +5G -r /dev/vg_data/lv_app`，`-r` 会顺带扩 XFS。
- 写 fstab 的语法：`echo "UUID=xxx /data xfs defaults 0 0" >> /etc/fstab`。

**参考解法（只是一种写法）**

```bash
lsblk
pvcreate /dev/vdb
vgcreate vg_data /dev/vdb
lvcreate -L 5G -n lv_app vg_data
mkfs.xfs /dev/vg_data/lv_app
mkdir -p /data
blkid /dev/vg_data/lv_app
echo "UUID=<上面查到的> /data xfs defaults 0 0" >> /etc/fstab
mount -a
findmnt /data
lvextend -L +5G -r /dev/vg_data/lv_app
df -hT /data
```

## 最小权限授权（`og-lab-grant-01`）

- 类型：SQL 控制台 · 层级：L2 状态实验 · 建议 12 分钟
- 适用版本：openGauss 7.0
- 归属：openGauss / og-02 / og-02-02 约束、序列与最小权限

**场景**：应用需要一个只读账号 app_ro：能连 appdb、能用 app schema、只能读 app.orders，不能改也不能删。建好后用 SET ROLE 实测一次。

**这一题要练**

- 说出 CONNECT / USAGE / SELECT 三层各自解决什么
- 用 GRANT 精确授权，不越权
- 用 SET ROLE 切换身份验证权限边界

**任务**

1. 创建角色 app_ro（可登录）
2. 授予它对数据库 appdb 的 CONNECT
3. 授予它对 schema app 的 USAGE
4. 授予它对表 app.orders 的 SELECT
5. 切到 app_ro 实测：SELECT 成功、DELETE 被拒绝

**校验项（合计 100 分）**

| 校验项 | 判据 | 分值 |
| --- | --- | --- |
| 角色 app_ro 已创建 | `roles.app_ro` 存在 | 15 |
| 已授予 appdb 的 CONNECT | `grants` 具备 {'priv': 'CONNECT', 'object': 'database:appdb', 'role': 'app_ro'} | 20 |
| 已授予 app schema 的 USAGE | `grants` 具备 {'priv': 'USAGE', 'object': 'schema:app', 'role': 'app_ro'} | 20 |
| 已授予 app.orders 的 SELECT | `grants` 具备 {'priv': 'SELECT', 'object': 'table:app.orders', 'role': 'app_ro'} | 25 |
| 没有给 app_ro 任何 DELETE 权限 | `grants` 具备 {'priv': 'DELETE', 'role': 'app_ro', 'absent': True} | 20 |

**提示（可在页面逐条展开）**

- 三层缺一不可：连不上库、看不到 schema、读不到表，分别对应 CONNECT、USAGE、SELECT。
- 语法：`GRANT SELECT ON app.orders TO app_ro;`
- 验证用 `SET ROLE app_ro;` 再 `SELECT * FROM app.orders;`，最后 `RESET ROLE;`。

**参考解法（只是一种写法）**

```bash
CREATE ROLE app_ro LOGIN PASSWORD 'ChangeMe_2026';
GRANT CONNECT ON DATABASE appdb TO app_ro;
GRANT USAGE ON SCHEMA app TO app_ro;
GRANT SELECT ON app.orders TO app_ro;
\du
SET ROLE app_ro;
SELECT * FROM app.orders;
DELETE FROM app.orders WHERE id = 1;
RESET ROLE;
```

## 迁移依赖审查：给 6 个组件定处理方式（`kp-lab-scan-01`）

- 类型：证据审查 · 层级：L1 引导模拟 · 建议 10 分钟
- 适用版本：Kunpeng DevKit / AArch64
- 归属：鲲鹏应用开发 / kp-02 / kp-02-02 包与二进制架构检查

**场景**：要把一套 x86_64 上的 Java Web 应用迁到鲲鹏。下面是盘点时采到的证据，请给每个组件判定处理方式。判错一项就说明有一个风险点会被漏掉。

**这一题要练**

- 从 file / readelf / unzip / rpm 的输出里读出架构结论
- 区分“字节码跨架构”与“本地库不跨架构”
- 给每个组件定处理方式而不是笼统说“重编译”

**证据项与正确判定**

| 组件 | 证据 | 正确判定 | 为什么 |
| --- | --- | --- | --- |
| app.jar（业务主包） | $ file app.jar<br>app.jar: Zip archive data, at least v2.0 to extract<br>$ unzip -l app.jar ／ grep -c '\.so$'<br>0 | A. 可直接运行或安装 | 纯字节码、无本地库，只要换成 AArch64 的 JDK 就能跑；仍要跑一遍功能测试。 |
| libcodec.so（自研压缩库） | $ file libcodec.so<br>libcodec.so: ELF 64-bit LSB shared object, x86-64, version 1 (SYSV)<br>$ ls src/<br>Makefile  codec.c  codec.h | B. 需从源码重新编译 | x86-64 的 ELF，但有源码与 Makefile，按 AArch64 重新编译即可。 |
| agent.jar（监控 Agent） | $ unzip -l agent.jar ／ grep '\.so$'<br>  14208  2024-03-11 10:22   lib/libagent.so<br>$ file lib/libagent.so   # 从 jar 中解出<br>lib/libagent.so: ELF 64-bit LSB shared object, x86-64 | C. 需替换本地库或基础镜像 | JAR 里打包了 x86-64 的 JNI 库，字节码没问题但本地库必须换成厂商提供的 AArch64 版本。 |
| 基础镜像 openjdk:8-jre | $ isula inspect openjdk:8-jre ／ grep -i arch<br>"Architecture": "amd64" | C. 需替换本地库或基础镜像 | 镜像 manifest 只有 amd64，必须换 AArch64 基础镜像或构建 multi-arch 镜像。 |
| codec-tools-1.2-1.x86_64.rpm | $ rpm -q --qf '%{NAME} %{ARCH}\n' -p codec-tools-1.2-1.x86_64.rpm<br>codec-tools x86_64<br>$ rpm -qlp codec-tools-1.2-1.x86_64.rpm<br>/usr/bin/codec<br>/usr/lib64/libcodec.so.1 | D. 无法直接使用，需要重做 | 厂商只提供 x86_64 构建且内含二进制，不能装到 AArch64；需要厂商出 AArch64 包，或自己重做。 |
| fonts-extra-2.0-3.noarch.rpm | $ rpm -q --qf '%{NAME} %{ARCH}\n' -p fonts-extra-2.0-3.noarch.rpm<br>fonts-extra noarch | A. 可直接运行或安装 | noarch 包不含架构相关二进制，两个架构都能装。 |

**提示（可在页面逐条展开）**

- 先看 ELF 的架构，再看有没有源码；有源码才能“重编译”。
- JAR 里可能有 .so，`unzip -l` 比 `file` 更能暴露问题。

**参考解法（只是一种写法）**

```bash
i1 → A：纯字节码，换 AArch64 JDK
i2 → B：有源码，重新编译
i3 → C：换厂商 AArch64 版 libagent.so
i4 → C：换 AArch64 基础镜像
i5 → D：只有 x86_64 构建，需厂商支持或重做
i6 → A：noarch 与架构无关
```

## 日志留存：硬链接、软链接与归档（`oe-lab-files-01`）

- 类型：终端 · 层级：L2 状态实验 · 建议 18 分钟
- 适用版本：openEuler 24.03-LTS-SP2
- 归属：openEuler / oe-01 / oe-01-01 路径、链接与查找

**场景**：/srv/source 下堆着三个日志，其中 app.log 已经 120 MiB。运维要求：app.log 要在 /srv/keep 下留一份可直接访问的副本；/srv/backup/current 要始终指向 old.log 这个路径；/srv/source 整体归档到 /srv/backup/source.tar.gz。最后 old.log 会被清理掉，你得保证清理之后该留的还在。

**这一题要练**

- 用 find 按类型与大小定位文件，注意 -size 的单位
- 用 ln 建硬链接，理解它共用 inode、不占额外空间
- 用 ln -s 建软链接，理解它只保存路径、目标删掉就悬空
- 用 tar 打包，并知道要在删除前归档

**任务**

1. 用 find 找出 /srv/source 下大于 100 MiB 的普通文件
2. 在 /srv/keep 下为 app.log 建一个同名硬链接
3. 在 /srv/backup 下建软链接 current，指向 /srv/source/old.log
4. 把 /srv/source 打包成 /srv/backup/source.tar.gz（gzip）
5. 删除 /srv/source/old.log
6. 验证：cat 硬链接仍有内容；cat 软链接报找不到；tar -tf 归档里 old.log 还在

**校验项（合计 100 分）**

| 校验项 | 判据 | 分值 |
| --- | --- | --- |
| /srv/keep/app.log 与 /srv/source/app.log 同 inode | `files./srv/keep/app.log.inode` same_inode /srv/source/app.log | 25 |
| /srv/backup/current 指向 /srv/source/old.log | `files./srv/backup/current.target` == `/srv/source/old.log` | 20 |
| 归档里有 old.log（说明是在删除前打包的） | `files./srv/backup/source.tar.gz.entries` archive_has old.log | 20 |
| /srv/source/old.log 已删除 | `files./srv/source/old.log` absent None | 20 |
| 硬链接内容仍完整（原文件删了也不影响） | `files./srv/keep/app.log.content` includes disk quota exceeded | 15 |

**提示（可在页面逐条展开）**

- `find /srv/source -type f -size +100M`：`-size` 的 `+` 是大于，单位 `M` 是 MiB。
- 硬链接：`ln 源文件 链接名`，两个名字共用同一个 inode。
- 软链接：`ln -s 目标 链接名`，注意参数顺序和硬链接一样是「源在前」。
- 打包要在删除之前：`tar -czf /srv/backup/source.tar.gz /srv/source`。

**参考解法（只是一种写法）**

```bash
find /srv/source -type f -size +100M
ln /srv/source/app.log /srv/keep/app.log
ln -s /srv/source/old.log /srv/backup/current
tar -czf /srv/backup/source.tar.gz /srv/source
rm /srv/source/old.log
stat /srv/keep/app.log
cat /srv/backup/current
tar -tzf /srv/backup/source.tar.gz
```

## 换静态地址，再确认端口在监听（`oe-lab-net-01`）

- 类型：终端 · 层级：L2 状态实验 · 建议 15 分钟
- 适用版本：openEuler 24.03-LTS-SP2
- 归属：openEuler / oe-06 / oe-06-01 nmcli 与监听端口

**场景**：这台服务器是刚接手的：eth0 还在用 DHCP 拿到的 192.168.10.50/24，网关 192.168.10.1 也是 DHCP 下发的。运维要求改成静态 192.168.10.80/24，网关不变，而且必须写进配置——重启 NetworkManager 之后还在，不能只在当前内核里生效。nginx 已经装好但没启动，改完地址后要确认 80 端口真的在监听。

**这一题要练**

- 分清 connection（保存的配置）与 device（网卡当前状态）两类对象
- 用 nmcli connection modify + up 把静态地址写进配置并生效
- 说清 ip addr add 为什么不算改配置
- 用 ss -lntp 查监听端口与归属进程

**任务**

1. 看现在有哪些连接配置，eth0 这个网卡绑的是哪个连接
2. 把 eth0 的连接改成手动地址 192.168.10.80/24，网关 192.168.10.1
3. 让新配置生效，确认内核里的地址已经变成 .80
4. 启动 nginx
5. 用 ss -lntp 确认 80 端口在监听、属主是 nginx
6. 验证持久性：配置里是 .80，内核里也只有 .80，没有 .50 残留

**校验项（合计 100 分）**

| 校验项 | 判据 | 分值 |
| --- | --- | --- |
| eth0 连接改为手动配置（ipv4.method=manual） | `network.connections.eth0.ipv4.method` == `manual` | 20 |
| 配置里写入了 192.168.10.80/24 | `network.connections.eth0.ipv4.addresses` 含 `192.168.10.80/24` | 25 |
| 配置里写入了网关 192.168.10.1 | `network.connections.eth0.ipv4.gateway` == `192.168.10.1` | 15 |
| 内核里 eth0 已有 192.168.10.80/24 | `network.kernel.eth0` 含 `192.168.10.80/24` | 10 |
| 内核里没有残留的 192.168.10.50/24 | `network.kernel.eth0` lacks 192.168.10.50/24 | 10 |
| nginx 已启动，80 端口在监听 | `services.nginx.service.active` == `True` | 20 |

**提示（可在页面逐条展开）**

- `nmcli connection show` 看保存的配置，`nmcli device status` 看网卡当前绑了哪个连接。
- `nmcli connection modify eth0 ipv4.method manual ipv4.addresses 192.168.10.80/24 ipv4.gateway 192.168.10.1`
- modify 只改配置不生效，要 `nmcli connection up eth0`；`ip addr add` 反过来只改内核、不写配置。
- `systemctl start nginx`，然后 `ss -lntp` 看 80 端口和它的进程名。

**参考解法（只是一种写法）**

```bash
nmcli connection show
nmcli device status
nmcli connection modify eth0 ipv4.method manual ipv4.addresses 192.168.10.80/24 ipv4.gateway 192.168.10.1
nmcli connection up eth0
systemctl start nginx
ss -lntp
ip addr show dev eth0
```

