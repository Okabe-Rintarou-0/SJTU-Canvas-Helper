import DocViewer, { DocRendererProps, IDocument } from "@cyntler/react-doc-viewer";
import { Space, Tree, TreeDataNode, TreeProps } from "antd";
import JSZip, { loadAsync, JSZipObject } from "jszip"
import { useEffect, useState } from "react";
import { DownOutlined } from '@ant-design/icons';
import useMessage from "antd/es/message/useMessage";
import { getFileType } from "../lib/utils";
import { BasicRenderers } from "./preview_modal";

export default function ZipRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;
    const [messageApi, contextHolder] = useMessage();
    const [treeData, setTreeData] = useState<TreeDataNode | undefined>(undefined);
    // const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
    const [selectedDoc, setSelectedDoc] = useState<IDocument | undefined>(undefined);
    const [fileMap, setFileMap] = useState<Map<string, JSZipObject> | undefined>(undefined);

    useEffect(() => { parseZip(); }, []);

    const parseZipStructure = (zip: JSZip) => {
        let treeData = {
            title: '',
            key: '',
            children: []
        } as TreeDataNode;
        // let expandedKeys = [""];
        let fileMap = new Map<string, JSZipObject>();
        zip.forEach(function (relativePath, file) {
            if (!file.dir) {
                fileMap.set(relativePath, file);
            }
            let pathArray = relativePath.split('/');
            let currentNode: TreeDataNode | undefined = treeData;
            let currentDir = "";
            pathArray.forEach(function (pathPart) {
                if (pathPart === "") {
                    return;
                }
                currentDir += currentDir.length > 0 ? "/" + pathPart : pathPart;
                let child = currentNode?.children?.find(data => data.title === pathPart);
                if (!child) {
                    // expandedKeys.push(currentDir);
                    child = {
                        title: pathPart,
                        key: currentDir,
                        children: []
                    } as TreeDataNode;
                    currentNode?.children?.push(child);
                }
                currentNode = child;
            });
        });
        // setExpandedKeys(expandedKeys);
        setFileMap(fileMap);
        return treeData;
    }

    const parseZip = async () => {
        try {
            let base64Content = (currentDocument.fileData as string).split(',')[1];
            let binaryData = atob(base64Content);
            let zip = await loadAsync(binaryData);
            setTreeData(parseZipStructure(zip))
        } catch (e) {
            console.log(e as string);
            messageApi.error(e as string);
        }
    }

    const onSelect: TreeProps['onSelect'] = async (_, info) => {
        let path = info.node.key as string;
        let file = fileMap?.get(path);
        if (file) {
            let blob = await file.async("blob");
            let doc = {
                uri: URL.createObjectURL(blob),
                fileName: file.name,
                fileType: getFileType(file.name),
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
                    }
                }}
                pluginRenderers={BasicRenderers}
                documents={[selectedDoc]}
            />}
        </Space>
    </>
}

ZipRenderer.fileTypes = ["zip"];
ZipRenderer.weight = 1;