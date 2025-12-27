import { DownOutlined } from "@ant-design/icons";
import DocViewer, { DocRendererProps, IDocument } from "@cyntler/react-doc-viewer";
import { invoke } from "@tauri-apps/api/core";
import { Button, Empty, Space, Tree, TreeDataNode, TreeProps } from "antd";
import useMessage from "antd/es/message/useMessage";
import { Archive } from "libarchive.js";
import { useEffect, useRef, useState } from "react";
import { LOG_LEVEL_ERROR } from "../lib/model";
import { consoleLog, dataURLtoFile, getFileType } from "../lib/utils";
import { ArchiveSupportedRenderers } from "./renderers";

interface BlackListEntry {
  name: string;
  dir: boolean;
}

// WE DON'T WANT TO SEE 'node_modules' AT ALL!
const BLACK_LIST: BlackListEntry[] = [{ name: "node_modules", dir: true }];

export default function ArchiveRenderer({
  mainState: { currentDocument },
}: DocRendererProps) {
  if (!currentDocument || !currentDocument.fileData) return null;
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [messageApi, contextHolder] = useMessage();
  const [treeData, setTreeData] = useState<TreeDataNode | undefined>();
  const [fileMap, setFileMap] = useState<Map<string, any> | undefined>();
  const [selectedDoc, setSelectedDoc] = useState<IDocument | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const archiveInitializedRef = useRef(false);

  const archiveWorkerUrl = new URL(
    "libarchive.js/dist/worker-bundle.js",
    import.meta.url
  ).toString();

  useEffect(() => {
    if (!archiveInitializedRef.current) {
      Archive.init({
        workerUrl: archiveWorkerUrl,
      });
      archiveInitializedRef.current = true;
    }
    parse();
  }, [currentDocument]);

  const checkIsBanned = (fileName: string, isDir: boolean) => {
    if (
      BLACK_LIST.find(
        (banned) => banned.name === fileName && banned.dir === isDir
      )
    ) {
      messageApi.warning(`文件或目录"${fileName}"已被屏蔽`, 2);
      return true;
    }
    return false;
  };

  const parseArchiveStructureBFS = async (root: any) => {
    let treeData = {
      title: "",
      key: "",
      children: [],
    } as TreeDataNode;
    const fileMap = new Map<string, File | null>();
    let currentDir = "";
    let queue: [any, TreeDataNode][] = [[root, treeData]];
    while (queue.length > 0) {
      let [currentNode, currentTreeData] = queue.shift()!;
      currentDir = currentTreeData.key as string;
      for (let fileName in currentNode) {
        let entry = currentNode[fileName];
        let thisPath = currentDir + "/" + fileName;
        let thisNode = {
          title: fileName,
          key: thisPath,
          children: [],
        } as TreeDataNode;
        let isDir = !entry["name"];
        if (checkIsBanned(fileName, isDir)) {
          continue;
        }
        if (!isDir) {
          try {
            fileMap.set(thisPath, entry);
          } catch (e) {
            fileMap.set(thisPath, null);
            messageApi.error(`文件${thisPath}解压失败！🙅🙅🙅`);
          }
        } else {
          queue.push([entry, thisNode]);
        }
        currentTreeData.children?.push(thisNode);
      }
    }
    setFileMap(fileMap);
    return treeData;
  };

  const parse = async () => {
    setLoading(true);
    setError(undefined);
    setSelectedDoc((oldDoc) => setDocAndGC(oldDoc, undefined));
    setSelectedPath("");
    setTreeData(undefined);
    setFileMap(undefined);
    try {
      let base64Content = currentDocument.fileData as string;
      let file = dataURLtoFile(
        base64Content,
        currentDocument.fileName ?? "tmp"
      );
      const archive = await Archive.open(file);
      let files = await archive.getFilesObject();
      let treeData = await parseArchiveStructureBFS(files);
      setTreeData(treeData);
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      consoleLog(LOG_LEVEL_ERROR, e);
      messageApi.error(errorMsg);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const setDocAndGC = (
    oldDoc: IDocument | undefined,
    newDoc: IDocument | undefined
  ) => {
    if (oldDoc) {
      URL.revokeObjectURL(oldDoc.uri);
    }
    return newDoc;
  };

  const onSelect: TreeProps["onSelect"] = async (_, info) => {
    let path = info.node.key as string;
    let fileReader = fileMap?.get(path);
    if (fileReader) {
      let file = await fileReader.extract();
      let doc = {
        uri: URL.createObjectURL(file),
        fileName: file.name,
        fileType: await getFileType(file.name),
      } as IDocument;
      setSelectedDoc((oldDoc) => setDocAndGC(oldDoc, doc));
      setSelectedPath(path);
    } else {
      setSelectedDoc((oldDoc) => setDocAndGC(oldDoc, undefined));
      if (fileReader === null) {
        messageApi.warning(`当前文件${path}解压失败，无法预览！😩😩😩`);
      }
    }
  };

  const handleDownloadSubFile = async () => {
    if (selectedDoc) {
      let fileReader = fileMap?.get(selectedPath);
      if (!fileReader) {
        return;
      }
      try {
        let file = await fileReader.extract();
        let buffer = await file.arrayBuffer();
        let content = Array.from<number>(new Uint8Array(buffer));
        let fileName = selectedDoc.fileName ?? "downloaded";
        await invoke("save_file_content", { content, fileName });
        messageApi.success("下载成功🎉！");
      } catch (e) {
        messageApi.error(`下载失败😩：${e}`);
      }
    }
  };

  useEffect(() => {
    return () => {
      // 清理资源
      if (selectedDoc) {
        URL.revokeObjectURL(selectedDoc.uri);
      }
    };
  }, [selectedDoc]);

  return (
    <>
      {contextHolder}
      <Space direction="vertical" style={{ width: "100%", height: "100%" }}>
        {loading ? (
          <div style={{ textAlign: "center", padding: "20px" }}>
            <h3>正在解析压缩包...</h3>
          </div>
        ) : error ? (
          <div style={{ textAlign: "center", padding: "20px" }}>
            <h3 style={{ color: "#ff4d4f" }}>解析失败</h3>
            <p>{error}</p>
          </div>
        ) : (
          <Space align="start" size={"large"} style={{ width: "100%", height: "100%" }}>
            <Space direction="vertical" style={{ height: "100%" }}>
              {selectedDoc && <Button onClick={handleDownloadSubFile}>下载</Button>}
              {treeData?.children && treeData.children.length > 0 ? (
                <Tree
                  showLine
                  switcherIcon={<DownOutlined />}
                  onSelect={onSelect}
                  treeData={treeData.children}
                  style={{ width: 300, overflowY: "auto" }}
                />
              ) : (
                <div style={{ textAlign: "center", padding: "20px" }}>
                  <p>压缩包为空</p>
                </div>
              )}
            </Space>
            {selectedDoc ? (
              <DocViewer
                key={selectedDoc.uri}
                config={{
                  header: {
                    disableHeader: true,
                    disableFileName: true,
                    retainURLParams: true,
                  },
                }}
                pluginRenderers={ArchiveSupportedRenderers}
                documents={[selectedDoc]}
                style={{ flex: 1, height: "100%" }}
              />
            ) : (
              <Empty />
            )}
          </Space>
        )}
      </Space>
    </>
  );
}

ArchiveRenderer.fileTypes = ["zip", "rar", "tar", "7z", "gz"];
ArchiveRenderer.weight = 1;
