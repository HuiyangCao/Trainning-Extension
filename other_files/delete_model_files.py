#!/usr/bin/env python3
"""
Delete model_*.pt files, keeping only 2 files per folder.

This script:
1. Deletes direct subfolders where .pt count is below a limit (default 8)
   and all model_*.pt numbers are below a max (default 5000)
2. Deletes model_*.pt files in each folder until only 2 remain
   (keeps the 2 with highest numbers)
"""

import argparse
import re
import shutil
import sys
from pathlib import Path
from typing import List, Tuple


def find_empty_folders(
    folder_path: Path,
    pt_count_limit: int,
    model_number_max_exclusive: int,
) -> List[Path]:
    """
    Find direct subfolders that contain fewer than ``pt_count_limit`` .pt files
    and every model_*.pt number is strictly less than ``model_number_max_exclusive``.
    """
    empty_folders: List[Path] = []

    try:
        for item in folder_path.iterdir():
            if item.is_dir():
                pt_files = list(item.glob("*.pt"))
                if len(pt_files) < pt_count_limit:
                    all_below_max = True
                    for pt_file in pt_files:
                        match = re.search(r"model_(\d+)\.pt", pt_file.name)
                        if match:
                            file_num = int(match.group(1))
                            if file_num >= model_number_max_exclusive:
                                all_below_max = False
                                break

                    if all_below_max:
                        empty_folders.append(item)
    except PermissionError:
        print(f"警告: 无法访问文件夹 '{folder_path}'", flush=True)

    empty_folders.sort(key=lambda x: x.name)
    return empty_folders


def delete_folders(
    folders_to_delete: List[Path],
    auto_confirm: bool = False,
    *,
    pt_count_limit: int,
    model_number_max_exclusive: int,
) -> Tuple[int, int]:
    """Delete specified folders. If auto_confirm, skip interactive prompt (e.g. IDE already confirmed)."""
    if not folders_to_delete:
        print("No empty folders found.", flush=True)
        return 0, 0

    print(
        f"\n以下文件夹包含少于{pt_count_limit}个.pt文件且所有model编号都小于{model_number_max_exclusive}，将被删除：",
        flush=True,
    )
    print("-" * 60, flush=True)
    for i, folder in enumerate(folders_to_delete, 1):
        print(f"{i}. {folder}", flush=True)
    print("-" * 60, flush=True)

    if not auto_confirm:
        while True:
            msg = f"\n确认删除这 {len(folders_to_delete)} 个文件夹吗？(y/n): "
            confirm = input(msg).strip().lower()
            if confirm in ["y", "yes", "是"]:
                break
            if confirm in ["n", "no", "否"]:
                print("已取消删除文件夹操作。", flush=True)
                return 0, 0
            print("请输入 y/yes/是 或 n/no/否", flush=True)
    else:
        print(f"\n(auto_confirm) 将删除上述 {len(folders_to_delete)} 个文件夹。", flush=True)

    deleted_count = 0
    failed_count = 0

    print("\n开始删除文件夹...", flush=True)
    for folder in folders_to_delete:
        try:
            shutil.rmtree(folder)
            deleted_count += 1
            print(f"已删除文件夹: {folder}", flush=True)
        except Exception as e:
            failed_count += 1
            print(f"删除文件夹失败 {folder}: {e}", flush=True)

    return deleted_count, failed_count


def delete_model_files(folder_path: str) -> Tuple[int, int]:
    """
    Recursively delete model_*.pt files until only 2 remain in each folder.
    Keeps the 2 files with the highest numbers.
    """
    folder = Path(folder_path)

    if not folder.exists():
        print(f"错误: 文件夹 '{folder_path}' 不存在！", flush=True)
        return 0, 0

    if not folder.is_dir():
        print(f"错误: '{folder_path}' 不是一个目录！", flush=True)
        return 0, 0

    deleted_count = 0
    failed_count = 0

    for current_folder in [folder] + list(folder.rglob("*")):
        if not current_folder.is_dir():
            continue

        pt_files = list(current_folder.glob("model_*.pt"))
        if len(pt_files) <= 2:
            continue

        files_with_numbers: List[Tuple[int, Path]] = []
        for pt_file in pt_files:
            match = re.search(r"model_(\d+)\.pt", pt_file.name)
            if match:
                file_num = int(match.group(1))
                files_with_numbers.append((file_num, pt_file))

        files_with_numbers.sort(key=lambda x: x[0], reverse=True)
        files_to_keep = {pt_file for _, pt_file in files_with_numbers[:2]}

        for _file_num, pt_file in files_with_numbers:
            if pt_file not in files_to_keep:
                try:
                    pt_file.unlink()
                    deleted_count += 1
                    print(f"已删除: {pt_file}", flush=True)
                except Exception as e:
                    failed_count += 1
                    print(f"删除失败 {pt_file}: {e}", flush=True)

    return deleted_count, failed_count


def run_pipeline(
    folder_path: str,
    auto_confirm_folders: bool,
    *,
    pt_count_limit: int,
    model_number_max_exclusive: int,
) -> int:
    """Run both steps; return process exit code (0 ok, 1 error)."""
    folder = Path(folder_path)
    if not folder.exists() or not folder.is_dir():
        print(f"错误: 无效路径 '{folder_path}'", flush=True)
        return 1

    if pt_count_limit < 1:
        print("错误: --folder-purge-pt-limit 必须 >= 1", flush=True)
        return 1
    if model_number_max_exclusive < 0:
        print("错误: --folder-purge-model-max 必须 >= 0", flush=True)
        return 1

    print("=" * 60, flush=True)
    print("删除模型文件工具", flush=True)
    print("=" * 60, flush=True)
    print("\n配置信息:", flush=True)
    print(f"  文件夹路径: {folder_path}", flush=True)
    print(f"  步骤1 .pt数量阈值: 直接子文件夹内 .pt 数 < {pt_count_limit}", flush=True)
    print(f"  步骤1 model编号上限(不含): 所有 model_*.pt 编号 < {model_number_max_exclusive}", flush=True)
    print("  步骤2: 每个文件夹保留编号最大的2个.pt文件", flush=True)

    print("\n" + "=" * 60, flush=True)
    print(
        f"步骤 1: 查找并删除包含少于{pt_count_limit}个.pt文件且所有model编号都小于{model_number_max_exclusive}的文件夹",
        flush=True,
    )
    print("=" * 60, flush=True)
    empty_folders = find_empty_folders(folder, pt_count_limit, model_number_max_exclusive)
    folder_deleted, folder_failed = delete_folders(
        empty_folders,
        auto_confirm=auto_confirm_folders,
        pt_count_limit=pt_count_limit,
        model_number_max_exclusive=model_number_max_exclusive,
    )

    print("\n" + "=" * 60, flush=True)
    print("步骤 2: 删除model_*.pt文件（每个文件夹保留2个）", flush=True)
    print("=" * 60, flush=True)
    file_deleted, file_failed = delete_model_files(folder_path)

    print("\n" + "=" * 60, flush=True)
    print("操作总结", flush=True)
    print("=" * 60, flush=True)
    print(f"删除的文件夹: {folder_deleted} 个", flush=True)
    print(f"删除失败的文件夹: {folder_failed} 个", flush=True)
    print(f"删除的.pt文件: {file_deleted} 个", flush=True)
    print(f"删除失败的.pt文件: {file_failed} 个", flush=True)
    print("=" * 60, flush=True)

    return 1 if (folder_failed or file_failed) else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="整理 Logs：删空子文件夹 + 每目录仅保留 2 个 model_*.pt")
    parser.add_argument(
        "--path",
        dest="path",
        help="要处理的根目录（由 VS Code 扩展传入）",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="跳过「删除子文件夹」的交互确认（扩展已在界面确认）",
    )
    parser.add_argument(
        "--folder-purge-pt-limit",
        type=int,
        default=8,
        metavar="N",
        help="直接子文件夹内 .pt 数量严格小于 N 时才可能整夹删除（默认 8）",
    )
    parser.add_argument(
        "--folder-purge-model-max",
        type=int,
        default=5000,
        metavar="M",
        help="上述文件夹内所有 model_*.pt 编号须严格小于 M（默认 5000）",
    )
    args = parser.parse_args()

    if args.path:
        code = run_pipeline(
            args.path,
            auto_confirm_folders=args.yes,
            pt_count_limit=args.folder_purge_pt_limit,
            model_number_max_exclusive=args.folder_purge_model_max,
        )
        sys.exit(code)

    # 交互模式（命令行单独运行）
    print("=" * 60, flush=True)
    print("删除模型文件工具", flush=True)
    print("=" * 60, flush=True)

    while True:
        folder_path = input("\n请输入要处理的文件夹路径: ").strip()
        if not folder_path:
            print("路径不能为空，请重新输入。", flush=True)
            continue

        folder = Path(folder_path)
        if not folder.exists():
            print(f"错误: 文件夹 '{folder_path}' 不存在！请重新输入。", flush=True)
            continue

        if not folder.is_dir():
            print(f"错误: '{folder_path}' 不是一个目录！请重新输入。", flush=True)
            continue

        break

    pt_s = input(
        "\n步骤1：子文件夹 .pt 数量阈值（少于该数量才可能整夹删除，直接回车默认 8）: "
    ).strip()
    model_s = input(
        "步骤1：model 编号上限（不含，即编号须 < 该值；直接回车默认 5000）: "
    ).strip()
    try:
        pt_limit = int(pt_s) if pt_s else 8
        model_max = int(model_s) if model_s else 5000
    except ValueError:
        print("错误: 请输入整数。", flush=True)
        sys.exit(1)
    if pt_limit < 1 or model_max < 0:
        print("错误: 阈值无效（pt 阈值须 >= 1，model 上限须 >= 0）。", flush=True)
        sys.exit(1)

    code = run_pipeline(
        folder_path,
        auto_confirm_folders=False,
        pt_count_limit=pt_limit,
        model_number_max_exclusive=model_max,
    )
    sys.exit(code)


if __name__ == "__main__":
    main()
