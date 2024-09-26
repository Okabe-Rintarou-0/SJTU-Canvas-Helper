import G6, { Graph, GraphData } from "@antv/g6";
import { createRef, useEffect, useState } from 'react';
import ReactDOM from "react-dom";
import { useRelationship } from "../lib/hooks";
import { Spin } from "antd";

const graphOpt = {
    fitView: true,
    modes: {
        default: [
            'drag-canvas',
            'zoom-canvas',
            'drag-node',
            { type: "activate-relations", activeState: 'active', inactiveState: 'inactive' },
        ]
    },
    layout: {
        type: 'force',
        preventOverlap: true,
        nodeSize: 150
    },
    defaultNode: {
        size: [80],
    },
    defaultEdge: {
        size: 1,
        color: '#e2e2e2'
    }
}

export default function RelationshipGraph() {
    const ref = createRef<HTMLDivElement>();
    const [graph, setGraph] = useState<any>(undefined);
    const relationship = useRelationship();

    useEffect(() => {
        let g: Graph = graph;
        if (!g) {
            g = constructGraph();
            setGraph(g);
        }
        g.clear();
        let topo = relationship.data;
        if (topo) {
            let nodes = topo.nodes.map(node => {
                switch (node.nodeType) {
                    case "Default":
                        return { id: node.id, label: node.label };
                    case "Me":
                        return {
                            id: node.id, label: node.label, style: {
                                fill: "#FFC1C1",
                                stroke: "#FF6A6A"
                            },
                        };
                    case "Course":
                        return {
                            id: node.id, label: node.label, style: {
                                fill: "#6495ED"
                            }
                        };
                }
            });
            let graphData = {
                nodes,
                edges: topo.edges
            }
            g.data(graphData as GraphData);
            g.render();
        }
    }, [relationship.data])

    const constructGraph = () => {
        const container = ReactDOM.findDOMNode(ref.current) as HTMLElement;
        const width = container.clientWidth;
        const height = container.clientHeight;

        let g = new G6.Graph({
            container,
            width: width,
            height: height,
            ...graphOpt
        });

        if (typeof window != "undefined") {
            window.onresize = () => {
                g.changeSize(container.clientWidth, container.clientHeight);
            }
        }
        g.get('canvas').set('localRefresh', false);
        return g;
    }
    return <div style={{ overflow: 'hidden' }}>
        <Spin spinning={relationship.isLoading} fullscreen tip="计算中💪，请耐心等待..." />
        <div style={{
            height: "100vh",
            width: "100%"
        }} ref={ref}>
        </div>
    </div>
}
