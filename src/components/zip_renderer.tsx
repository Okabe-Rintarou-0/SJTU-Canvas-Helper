import DocViewer, { DocRendererProps, IDocument } from "@cyntler/react-doc-viewer";
import { Space, Tree, TreeDataNode, TreeProps } from "antd";
import { useEffect, useState } from "react";
import { DownOutlined } from '@ant-design/icons';
import useMessage from "antd/es/message/useMessage";
import { dataURLtoFile, getFileType } from "../lib/utils";
import { BasicRenderers } from "./renderers";

import { Archive } from 'libarchive.js'

const archiveWorkerUrl = new URL(
    'libarchive.js/dist/worker-bundle.js',
    import.meta.url,
).toString();

Archive.init({
    workerUrl: archiveWorkerUrl,
});

export default function ZipRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;
    const [messageApi, contextHolder] = useMessage();
    const [treeData, setTreeData] = useState<TreeDataNode | undefined>(undefined);
    const [fileMap, setFileMap] = useState<Map<string, File> | undefined>(undefined);
    const [selectedDoc, setSelectedDoc] = useState<IDocument | undefined>(undefined);


    useEffect(() => { parse(); }, []);

    const parseArchiveStructure = (root: any, currentDir: string, fileMap: Map<string, File>) => {
        let pathParts = currentDir.split("/");
        let currentDirName = pathParts[pathParts.length - 1];
        let treeData = {
            title: currentDirName,
            key: currentDir,
            children: []
        } as TreeDataNode;

        for (let fileName in root) {
            let file = root[fileName];
            let name = file["name"];
            let thisPath = currentDir + "/" + fileName;
            if (name) {
                let thisNode = {
                    title: name,
                    key: thisPath,
                    children: []
                } as TreeDataNode;
                fileMap.set(thisPath, file);
                treeData.children?.push(thisNode);
            } else {
                let dirNode = parseArchiveStructure(file, thisPath, fileMap);
                treeData.children?.push(dirNode);
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
            let files = await archive.extractFiles();
            let treeData = parseArchiveStructure(files, "", new Map<string, File>);
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
                pluginRenderers={BasicRenderers}
                documents={[selectedDoc]}
            />}
        </Space>
    </>
}

ZipRenderer.fileTypes = ["zip", "rar", "tar", "7z"];
ZipRenderer.weight = 1;