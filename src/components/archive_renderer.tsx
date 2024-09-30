import DocViewer, { DocRendererProps, IDocument } from "@cyntler/react-doc-viewer";
import { Button, Space, Tree, TreeDataNode, TreeProps } from "antd";
import { useEffect, useState } from "react";
import { DownOutlined } from '@ant-design/icons';
import useMessage from "antd/es/message/useMessage";
import { consoleLog, dataURLtoFile, getFileType } from "../lib/utils";
import { ArchiveSupportedRenderers } from "./renderers";
import { Archive } from 'libarchive.js';
import { invoke } from "@tauri-apps/api";
import { LOG_LEVEL_ERROR } from "../lib/model";

interface BlackListEntry {
    name: string,
    dir: boolean,
}

// WE DON'T WANT TO SEE 'node_modules' AT ALL!
const BLACK_LIST: BlackListEntry[] = [{ name: 'node_modules', dir: true }];

const archiveWorkerUrl = new URL(
    'libarchive.js/dist/worker-bundle.js',
    import.meta.url,
).toString();

Archive.init({
    workerUrl: archiveWorkerUrl,
});

export default function ArchiveRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument || !currentDocument.fileData) return null;
    const [selectedPath, setSelectedPath] = useState<string>("");
    const [messageApi, contextHolder] = useMessage();
    const [treeData, setTreeData] = useState<TreeDataNode | undefined>();
    const [fileMap, setFileMap] = useState<Map<string, any> | undefined>();
    const [selectedDoc, setSelectedDoc] = useState<IDocument | undefined>();

    useEffect(() => {
        parse();

    }, []);

    const checkIsBanned = (fileName: string, isDir: boolean) => {
        if (BLACK_LIST.find(banned => banned.name === fileName && banned.dir === isDir)) {
            messageApi.warning(`文件或目录"${fileName}"已被屏蔽`, 2);
            return true;
        }
        return false;
    }

    const parseArchiveStructureBFS = async (root: any) => {
        let treeData = {
            title: "",
            key: "",
            children: []
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
                    children: []
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
                        messageApi.error(`文件${thisPath}解压失败！🙅🙅🙅`)
                    }
                } else {
                    queue.push([entry, thisNode]);
                }
                currentTreeData.children?.push(thisNode);
            }
        }
        setFileMap(fileMap);
        return treeData;
    }

    const parse = async () => {
        try {
            let base64Content = currentDocument.fileData as string;
            let file = dataURLtoFile(base64Content, currentDocument.fileName ?? "tmp");
            const archive = await Archive.open(file);
            let files = await archive.getFilesObject();
            let treeData = await parseArchiveStructureBFS(files);
            setTreeData(treeData);
        } catch (e) {
            consoleLog(LOG_LEVEL_ERROR, e);
            messageApi.error(e as string);
        }
    }

    const setDocAndGC = (oldDoc: IDocument | undefined, newDoc: IDocument | undefined) => {
        if (oldDoc) {
            URL.revokeObjectURL(oldDoc.uri);
        }
        return newDoc;
    }

    const onSelect: TreeProps['onSelect'] = async (_, info) => {
        let path = info.node.key as string;
        let fileReader = fileMap?.get(path);
        if (fileReader) {
            let file = await fileReader.extract();
            let doc = {
                uri: URL.createObjectURL(file),
                fileName: file.name,
                fileType: await getFileType(file.name),
            } as IDocument;
            setSelectedDoc(oldDoc => setDocAndGC(oldDoc, doc));
            setSelectedPath(path);
        } else {
            setSelectedDoc(oldDoc => setDocAndGC(oldDoc, undefined));
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
    }

    return <>
        {contextHolder}
        <Space align="start" size={"large"}>
            <Space direction="vertical">
                {selectedDoc && <Button onClick={handleDownloadSubFile}>下载</Button>}
                <Tree
                    showLine
                    switcherIcon={<DownOutlined />}
                    onSelect={onSelect}
                    treeData={treeData?.children}
                />
            </Space>
            {selectedDoc && <DocViewer
                key={selectedDoc.uri}
                config={{
                    header: {
                        disableHeader: true,
                        disableFileName: true,
                        retainURLParams: true
                    },
                }}
                pluginRenderers={ArchiveSupportedRenderers}
                documents={[selectedDoc]}
            />}
        </Space>
    </>
}

ArchiveRenderer.fileTypes = ["zip", "rar", "tar", "7z", "gz"];
ArchiveRenderer.weight = 1;