import type { DocumentFolder } from "../../types/documents";
import { bertRowInteractive } from "../animation/animationClasses";

type Props = {
  folders: DocumentFolder[];
  selectedFolderId: string;
  onSelect: (folderRecordId: string) => void;
};

type TreeNode = DocumentFolder & { children: TreeNode[] };

function buildTree(folders: DocumentFolder[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const folder of folders) {
    byId.set(folder.folderRecordId, { ...folder, children: [] });
  }
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parentFolderRecordId ? byId.get(node.parentFolderRecordId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.folderName.localeCompare(b.folderName));
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);
  return roots;
}

function FolderNode({
  node,
  depth,
  selectedFolderId,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedFolderId: string;
  onSelect: (folderRecordId: string) => void;
}) {
  const selected = node.folderRecordId === selectedFolderId;
  return (
    <div>
      <button
        type="button"
        className={`${bertRowInteractive} w-full text-left rounded-lg px-3 py-2 text-sm ${selected ? "bg-slate-100 font-medium" : ""}`}
        style={{ paddingLeft: `${12 + depth * 14}px` }}
        onClick={() => onSelect(node.folderRecordId)}
      >
        {node.folderName}
      </button>
      {node.children.map((child) => (
        <FolderNode
          key={child.folderRecordId}
          node={child}
          depth={depth + 1}
          selectedFolderId={selectedFolderId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

export function DocumentFolderTree({ folders, selectedFolderId, onSelect }: Props) {
  const tree = buildTree(folders.filter((folder) => folder.active !== false));
  if (tree.length === 0) {
    return <p className="text-sm text-slate-500 px-3 py-2">No folders provisioned yet.</p>;
  }
  return (
    <div className="space-y-0.5 max-h-[420px] overflow-y-auto">
      <button
        type="button"
        className={`${bertRowInteractive} w-full text-left rounded-lg px-3 py-2 text-sm ${!selectedFolderId ? "bg-slate-100 font-medium" : ""}`}
        onClick={() => onSelect("")}
      >
        All folders
      </button>
      {tree.map((node) => (
        <FolderNode
          key={node.folderRecordId}
          node={node}
          depth={0}
          selectedFolderId={selectedFolderId}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
