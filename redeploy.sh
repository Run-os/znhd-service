#!/bin/bash

# ==============================================================================
# 脚本名称: redeploy.sh
# 功能: 自动拉取 Gitee 最新代码并重新部署 Docker 服务
# 仓库: https://gitee.com/runos/znhd-service.git
# 项目结构: 根目录/server/ 包含 docker-compose.yml
# ==============================================================================

set -e  # 遇到错误立即退出

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置变量
REPO_URL="https://gitee.com/runos/znhd-service.git"
# 检测当前目录是否已是项目目录
if [ -f "server/docker-compose.yml" ]; then
    # 在项目根目录运行
    PROJECT_DIR="."
    BACKUP_DIR="backup_$(date +%Y%m%d_%H%M%S)"
    COMPOSE_FILE="server/docker-compose.yml"
else
    # 首次克隆或在不同位置运行
    PROJECT_DIR="znhd-service"
    BACKUP_DIR="backup_$(date +%Y%m%d_%H%M%S)"
    COMPOSE_FILE="server/docker-compose.yml"
fi

# ==============================================================================
# 函数定义
# ==============================================================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查命令是否存在
check_command() {
    if ! command -v $1 &> /dev/null; then
        log_error "$1 未安装，请先安装"
        exit 1
    fi
}

# 备份当前代码（可选）
backup_current() {
    # 只在克隆仓库模式下备份，避免在根目录重复备份
    if [ "$PROJECT_DIR" != "." ] && [ -d "$PROJECT_DIR" ]; then
        log_info "备份当前代码到 $BACKUP_DIR..."
        cp -r "$PROJECT_DIR" "$BACKUP_DIR"
        log_success "备份完成"
    elif [ "$PROJECT_DIR" == "." ]; then
        log_info "在根目录运行，跳过备份步骤..."
    fi
}

# 拉取最新代码
pull_code() {
    # 修改：移除 PROJECT_DIR == "." 的判断，无论在哪里运行都强制拉取最新代码
    # 原逻辑：在项目根目录运行时（PROJECT_DIR="."）跳过 git 操作
    # 新逻辑：总是拉取最新代码（会覆盖本地修改）
    
    if [ "$PROJECT_DIR" != "." ] && [ -d "$PROJECT_DIR/.git" ]; then
        log_info "检测到已有仓库，执行 git pull..."
        cd "$PROJECT_DIR"
        
        # 保存本地修改（如果有）
        git stash push -m "auto-stash-$(date +%Y%m%d)" 2>/dev/null || true
        
        # 拉取最新代码
        git pull origin main || git pull origin master
        
        # 恢复本地修改（如果有冲突需要手动解决）
        git stash pop 2>/dev/null || true
        
        log_success "代码更新完成（可能已覆盖本地修改）"
    elif [ "$PROJECT_DIR" == "." ]; then
        # 在项目根目录：初始化 Git 仓库或拉取最新代码
        if [ -d ".git" ]; then
            log_info "检测到本地 Git 仓库，拉取最新代码..."
            # 保存本地修改（如果有）
            git stash push -m "auto-stash-$(date +%Y%m%d)" 2>/dev/null || true
            # 拉取最新代码
            git pull origin main || git pull origin master
            # 恢复本地修改（如果有冲突需要手动解决）
            git stash pop 2>/dev/null || true
            log_success "代码更新完成（可能已覆盖本地修改）"
        else
            log_info "本地不是 Git 仓库，尝试初始化..."
            # 初始化仓库
            git init
            git remote add origin "$REPO_URL"
            git fetch origin
            git checkout -b main origin/main 2>/dev/null || git checkout -b master origin/master
            log_success "仓库初始化完成"
        fi
    else
        log_info "首次克隆仓库..."
        git clone "$REPO_URL" "$PROJECT_DIR"
        log_success "仓库克隆完成"
    fi
}

# 显示最新版本信息
show_version() {
    # 修复条件判断：使用 OR（||）而不是 AND（&&）
    # 原逻辑：PROJECT_DIR != "." && PROJECT_DIR/.git 存在
    # 问题：当在项目根目录运行时（PROJECT_DIR="."），第一个条件为 false，整个判断失败
    # 新逻辑：PROJECT_DIR != "." 且 PROJECT_DIR/.git 存在，或者当前目录有 .git
    if { [ "$PROJECT_DIR" != "." ] && [ -d "$PROJECT_DIR/.git" ]; } || [ -d ".git" ]; then
        if [ "$PROJECT_DIR" != "." ]; then
            cd "$PROJECT_DIR"
        fi
        local latest_tag=$(git describe --tags --abrev=0 2>/dev/null || echo "无标签")
        # 修复：%ci 不是有效的 Git 占位符，改为 %cn（提交者名称）
        local latest_commit=$(git log -1 --pretty=format:"%h - %s (%cn)")
        if [ "$PROJECT_DIR" != "." ]; then
            cd ..
        fi
        log_info "✅ 最新提交: $latest_commit"
    else
        log_info "无法获取版本信息，未检测到 Git 仓库"
    fi
}


# 检查 docker-compose 文件
check_compose_file() {
    # 如果在根目录，检查 server/docker-compose.yml
    if [ "$PROJECT_DIR" == "." ]; then
        if [ ! -f "server/docker-compose.yml" ]; then
            log_error "未找到 server/docker-compose.yml 文件，请检查项目结构"
            exit 1
        fi
    else
        if [ ! -f "$PROJECT_DIR/$COMPOSE_FILE" ]; then
            log_error "未找到 $PROJECT_DIR/$COMPOSE_FILE 文件，请检查项目结构"
            exit 1
        fi
    fi
}

# 停止旧服务
stop_services() {
    log_info "🛑 停止现有 Docker 服务..."
    if [ "$PROJECT_DIR" == "." ]; then
        cd server
    else
        cd "$PROJECT_DIR"
    fi
    docker-compose down --remove-orphans
    cd ..
    log_success "服务已停止"
}

# 重新构建并启动
rebuild_and_start() {
    log_info "🏗️ 重新构建 Docker 镜像..."
    
    # 进入正确的目录
    if [ "$PROJECT_DIR" == "." ]; then
        cd server
    else
        cd "$PROJECT_DIR"
    fi
    
    # 可选：根据参数决定是否使用 --no-cache
    if [ "$1" == "--no-cache" ]; then
        log_warn "使用 --no-cache 强制重新构建（较慢）"
        docker-compose build --no-cache
    else
        docker-compose build
    fi
    
    log_info "🚀 启动服务..."
    docker-compose up -d
    
    # 等待服务启动
    sleep 3
    
    # 检查服务状态
    if docker-compose ps | grep -q "Up"; then
        log_success "服务启动成功！"
        docker-compose ps
    else
        log_error "服务启动失败，请检查日志："
        docker-compose logs --tail=50
        exit 1
    fi
    
    cd ..
}

# 清理旧资源
cleanup() {
    log_info "🧹 清理旧镜像和卷..."
    docker image prune -f
    docker volume prune -f 2>/dev/null || true
    log_success "清理完成"
}

# 显示部署信息
show_info() {
    echo ""
    echo "========================================"
    log_success "🎉 部署完成！"
    echo "========================================"
    echo ""
    if [ "$PROJECT_DIR" == "." ]; then
        log_info "项目路径: $(pwd)"
        log_info "服务目录: $(pwd)/server"
        echo ""
        log_info "常用命令："
        echo "  查看日志: cd server && docker-compose logs -f"
        echo "  进入容器: cd server && docker-compose exec app bash"
        echo "  停止服务: cd server && docker-compose down"
        echo "  重启服务: cd server && docker-compose restart"
    else
        log_info "项目路径: $(pwd)/$PROJECT_DIR"
        log_info "备份路径: $(pwd)/$BACKUP_DIR (如需要恢复)"
        echo ""
        log_info "常用命令："
        echo "  查看日志: cd $PROJECT_DIR && docker-compose logs -f"
        echo "  进入容器: cd $PROJECT_DIR && docker-compose exec app bash"
        echo "  停止服务: cd $PROJECT_DIR && docker-compose down"
        echo "  重启服务: cd $PROJECT_DIR && docker-compose restart"
    fi
    echo ""
}

# ==============================================================================
# 主流程
# ==============================================================================

main() {
    # 清屏
    clear
    
    echo "========================================"
    echo "  🚀 自动化部署脚本"
    echo "  仓库: $REPO_URL"
    echo "  时间: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "========================================"
    echo ""

    # 检查依赖
    check_command git
    check_command docker
    check_command docker-compose

    # 执行部署流程
    backup_current
    pull_code
    show_version
    check_compose_file
    stop_services
    rebuild_and_start "$1"  # 传递参数决定是否使用 --no-cache
    cleanup
    show_info
}

# 处理脚本参数
case "$1" in
    --no-cache)
        main "--no-cache"
        ;;
    --help|-h)
        echo "用法: $0 [选项]"
        echo ""
        echo "选项："
        echo "  --no-cache    强制重新构建镜像，不使用缓存"
        echo "  --help, -h    显示帮助信息"
        echo ""
        echo "示例："
        echo "  $0                    # 普通部署（使用缓存）"
        echo "  $0 --no-cache         # 强制重新构建"
        exit 0
        ;;
    *)
        main
        ;;
esac