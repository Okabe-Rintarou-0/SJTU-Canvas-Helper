import DocViewer, { DocRendererProps, IDocument } from "@cyntler/react-doc-viewer";
import { Space, Tree, TreeDataNode, TreeProps } from "antd";
import { useEffect, useState } from "react";
import { DownOutlined } from '@ant-design/icons';
import useMessage from "antd/es/message/useMessage";
import { dataURLtoFile, getFileType } from "../lib/utils";
import { ArchiveSupportedRenderers } from "./renderers";
import { Archive } from 'libarchive.js';

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
    if (!currentDocument) return null;
    const [messageApi, contextHolder] = useMessage();
    const [treeData, setTreeData] = useState<TreeDataNode | undefined>(undefined);
    const [fileMap, setFileMap] = useState<Map<string, File> | undefined>(undefined);
    const [selectedDoc, setSelectedDoc] = useState<IDocument | undefined>(undefined);


    useEffect(() => { parse(); }, []);

    const checkIsBanned = (fileName: string, isDir: boolean) => {
        if (BLACK_LIST.find(banned => banned.name === fileName && banned.dir === isDir)) {
            messageApi.warning(`文件或目录"${fileName}"已被屏蔽`);
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
        const fileMap = new Map<string, File>();
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
                        fileMap.set(thisPath, await entry.extract());
                    } catch (e) {
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
            console.log(e as string);
            messageApi.error(e as string);
        }
    }

    const onSelect: TreeProps['onSelect'] = async (_, info) => {
        let path = info.node.key as string;
        let file = fileMap?.get(path);
        if (file) {
            let doc = {
                uri: URL.createObjectURL(file),
                fileName: file.name,
                fileType: await getFileType(file.name),
            } as IDocument;
            setSelectedDoc(doc);
        } else if (!info.node.children?.length) {
            messageApi.warning(`当前文件${path}解压失败，无法预览！😩😩😩`);
        }
    };

    return <>
        {contextHolder}
        <Space align="start" size={"large"}>
            <Tree
                showLine
                switcherIcon={<DownOutlined />}
                onSelect={onSelect}
                treeData={treeData?.children}
            />
            {selectedDoc && <DocViewer
                style={{ position: "sticky" }}
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

ArchiveRenderer.fileTypes = ["zip", "rar", "tar", "7z"];
ArchiveRenderer.weight = 1;