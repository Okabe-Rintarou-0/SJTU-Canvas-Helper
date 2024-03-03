import { DocRendererProps } from "@cyntler/react-doc-viewer";
import { Tree, TreeDataNode } from "antd";
import JSZip, { loadAsync } from "jszip"
import { useEffect, useState } from "react";
import { DownOutlined } from '@ant-design/icons';
import useMessage from "antd/es/message/useMessage";

export function ZipRenderer({
    mainState: { currentDocument },
}: DocRendererProps) {
    if (!currentDocument) return null;
    const [messageApi, contextHolder] = useMessage();
    const [treeData, setTreeData] = useState<TreeDataNode | undefined>(undefined);
    const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

    useEffect(() => { parseZip(); }, []);

    const parseZipStructure = (zip: JSZip) => {
        let treeData = {
            title: '',
            key: '',
            children: []
        } as TreeDataNode;
        let expandedKeys = [""];
        zip.forEach(function (relativePath) {
            let pathArray = relativePath.split('/');
            let currentNode: TreeDataNode | undefined = treeData;
            let currentDir = "";
            pathArray.forEach(function (pathPart) {
                if (pathPart === "") {
                    return;
                }
                currentDir += "/" + pathPart;
                let child = currentNode?.children?.find(data => data.title === pathPart);
                if (!child) {
                    expandedKeys.push(currentDir);
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
        setExpandedKeys(expandedKeys);
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

    return <>
        {contextHolder}
        <Tree
            showLine
            switcherIcon={<DownOutlined />}
            expandedKeys={expandedKeys}
            // onSelect={onSelect}
            treeData={treeData?.children}
        />
    </>
}

ZipRenderer.fileTypes = ["zip"];
ZipRenderer.weight = 1;