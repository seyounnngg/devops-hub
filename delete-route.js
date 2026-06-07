app.delete('/deployments/:id', async (req, res) => {

    try {

        const { id } = req.params;

        const [rows] = await pool.execute(
            'SELECT * FROM deployments WHERE id = ?',
            [id]
        );

        if (rows.length === 0) {

            return res.status(404).json({
                error: 'Deployment not found'
            });
        }

        const deployment = rows[0];

        exec(`docker stop ${deployment.container_name}`);
        exec(`docker rm ${deployment.container_name}`);
        exec(`docker rmi ${deployment.image_name}`);

        await pool.execute(
            'DELETE FROM deployments WHERE id = ?',
            [id]
        );

        res.json({
            success: true
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: 'Delete failed'
        });
    }
});
